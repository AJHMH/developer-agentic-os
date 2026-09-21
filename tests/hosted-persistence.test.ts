import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  applyCanonicalHostedSchemaMigrations,
  canonicalHostedSchemaMigrations,
  canonicalHostedSchemaTables,
} from "../src/server/hosted-persistence/canonical-hosted-schema";
import {
  EncryptedProtectedSecretStore,
  hostedDatabaseUrl,
  NeonHostedStateProvider,
  resolveHostedTenantDatabaseId,
} from "../src/server/hosted-persistence/neon-hosted-provider";
import type {
  HostedState,
  HostedStateProvider,
} from "../src/server/hosted-domain/hosted-domain-store";
import { HostedDomainStore } from "../src/server/hosted-domain/hosted-domain-store";
import { RejectingHostedObjectStore } from "../src/server/hosted-domain/hosted-object-store";
import type {
  HostedWorkspaceState,
  HostedWorkspaceStateProvider,
} from "../src/server/hosted-workspaces/hosted-workspace-store";
import {
  HostedWorkspaceStore,
  hostedWorkspaceStoreForTenant,
} from "../src/server/hosted-workspaces/hosted-workspace-store";
import { hostedDomainStoreForTenant } from "../src/server/hosted-domain/hosted-domain-store";

const emptyDomainState = (): HostedState => ({
  repositories: {},
  records: {},
  relationships: {},
  snapshots: {},
  connectors: [],
  credentials: [],
  audit: [],
});
const emptyWorkspaceState = (): HostedWorkspaceState => ({ users: {}, audit: [] });

async function createPgLite(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid AS $$
      SELECT (
        substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 9, 4) || '-' ||
        '4' || substr(md5(random()::text || clock_timestamp()::text), 14, 3) || '-' ||
        'a' || substr(md5(random()::text || clock_timestamp()::text), 18, 3) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 21, 12)
      )::uuid;
    $$ LANGUAGE SQL;
  `);
  return db;
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function pgLiteQueryable(db: PGlite) {
  return {
    async query<Row = unknown>(
      query: string,
      values?: unknown[]
    ): Promise<{ rowCount: number; rows: Row[] }> {
      const sql = values
        ? query.replaceAll(/\$(\d+)/g, (_, index: string) =>
            toSqlLiteral(values[Number.parseInt(index, 10) - 1])
          )
        : query;
      const statement = sql.trim().toUpperCase();
      if (statement.startsWith("SELECT")) {
        const result = await db.query<Row>(sql);
        return { rowCount: result.rows.length, rows: result.rows };
      }
      await db.exec(sql);
      return { rowCount: 0, rows: [] as Row[] };
    },
  };
}

class FakeSchemaProvisioningClient {
  readonly versions = new Set<string>();
  readonly appliedSql: string[] = [];

  async query<Row = unknown>(
    query: string,
    values?: unknown[]
  ): Promise<{ rowCount: number; rows: Row[] }> {
    const sql = query.trim();
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations"))
      return { rowCount: 0, rows: [] as Row[] };
    if (sql === "SELECT version FROM schema_migrations WHERE version = $1") {
      const version = values?.[0] as string;
      return this.versions.has(version)
        ? { rowCount: 1, rows: [{ version }] as Row[] }
        : { rowCount: 0, rows: [] as Row[] };
    }
    if (sql === "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING") {
      this.versions.add(values?.[0] as string);
      return { rowCount: 1, rows: [] as Row[] };
    }
    this.appliedSql.push(query);
    return { rowCount: 0, rows: [] as Row[] };
  }
}

class MemoryDomainProvider implements HostedStateProvider {
  constructor(private state: HostedState) {}
  async read(): Promise<HostedState> {
    return structuredClone(this.state);
  }
  async write(state: HostedState): Promise<void> {
    this.state = structuredClone(state);
  }
}

class TransactionalMemoryDomainProvider implements HostedStateProvider {
  private state = emptyDomainState();
  private transaction = Promise.resolve();
  private readsWaiting = 0;
  private releaseReads: (() => void) | null = null;
  private inTransaction = false;
  private synchronizeUnlockedReads = true;

  async read(): Promise<HostedState> {
    if (!this.inTransaction && this.synchronizeUnlockedReads) {
      this.readsWaiting += 1;
      if (this.readsWaiting === 1)
        await new Promise<void>((resolve) => {
          this.releaseReads = resolve;
        });
      else this.releaseReads?.();
    }
    return structuredClone(this.state);
  }

  async write(state: HostedState): Promise<void> {
    this.state = structuredClone(state);
  }

  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    this.synchronizeUnlockedReads = false;
    const previous = this.transaction;
    let release: () => void = () => undefined;
    this.transaction = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.inTransaction = true;
    try {
      return await operation();
    } finally {
      this.inTransaction = false;
      release();
    }
  }
}

class MemoryWorkspaceProvider implements HostedWorkspaceStateProvider {
  constructor(private state: HostedWorkspaceState) {}
  async read(): Promise<HostedWorkspaceState> {
    return structuredClone(this.state);
  }
  async write(state: HostedWorkspaceState): Promise<void> {
    this.state = structuredClone(state);
  }
}

class TransactionalMemoryWorkspaceProvider implements HostedWorkspaceStateProvider {
  private state = emptyWorkspaceState();
  private transaction = Promise.resolve();
  private readsWaiting = 0;
  private releaseReads: (() => void) | null = null;
  private inTransaction = false;
  private synchronizeUnlockedReads = true;

  async read(): Promise<HostedWorkspaceState> {
    if (!this.inTransaction && this.synchronizeUnlockedReads) {
      this.readsWaiting += 1;
      if (this.readsWaiting === 1)
        await new Promise<void>((resolve) => {
          this.releaseReads = resolve;
        });
      else this.releaseReads?.();
    }
    return structuredClone(this.state);
  }

  async write(state: HostedWorkspaceState): Promise<void> {
    this.state = structuredClone(state);
  }

  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    this.synchronizeUnlockedReads = false;
    const previous = this.transaction;
    let release: () => void = () => undefined;
    this.transaction = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.inTransaction = true;
    try {
      return await operation();
    } finally {
      this.inTransaction = false;
      release();
    }
  }
}

test("hosted stores persist through injected deterministic providers", async () => {
  const workspaceProvider = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const domainProvider = new MemoryDomainProvider(emptyDomainState());
  const workspaceStore = new HostedWorkspaceStore(process.cwd(), workspaceProvider);
  const domainStore = new HostedDomainStore(
    process.cwd(),
    workspaceStore,
    domainProvider,
    undefined,
    undefined,
    { put: async () => "test-secret-reference" }
  );
  const workspace = await domainStore.createWorkspace("alice", "Neon-shaped fixture");
  const repository = await domainStore.registerRepository("alice", workspace.id, "D:/repos/app");
  const record = await domainStore.putRecord("alice", workspace.id, "workItems", {
    repositoryId: repository.id,
    title: "Persisted",
  });

  assert.equal((await workspaceStore.list("alice"))[0].id, workspace.id);
  assert.equal(
    (await domainStore.listRecords("alice", workspace.id, "workItems"))[0].id,
    record.id
  );
  assert.equal((await domainStore.listRepositories("alice", workspace.id))[0].id, repository.id);
});

test("fresh hosted provisioning uses authoritative contract migrations", async () => {
  assert.deepEqual(canonicalHostedSchemaMigrations, [
    "migrations/005-hosted-canonical-contract.sql",
    "migrations/006-hosted-object-storage.sql",
    "migrations/007-hosted-workspace-members-and-invitations.sql",
  ]);
  const sql = (
    await Promise.all(
      canonicalHostedSchemaMigrations.map((m) => readFile(resolve(process.cwd(), m), "utf8"))
    )
  ).join("\n");
  for (const table of canonicalHostedSchemaTables)
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS artifacts\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS work_items\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS skills\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS routines\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS handoffs\b/i);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS deployment_events\b/i);
  assert.match(
    sql,
    /UNIQUE\s+\(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id,\s*event_type\)/i
  );
  assert.match(
    sql,
    /DROP INDEX IF EXISTS idx_vercel_webhook_delivery_id;\s+CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_delivery_id\s+ON vercel_webhook_events\(tenant_id,\s*delivery_id\) WHERE delivery_id IS NOT NULL;/i
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_delivery_id\s+ON vercel_webhook_events\(tenant_id,\s*delivery_id\) WHERE delivery_id IS NOT NULL;/i
  );
  assert.match(sql, /PRIMARY KEY\s+\(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id\)/i);
  assert.match(sql, /PRIMARY KEY\s+\(tenant_id,\s*source_id\)/i);
  assert.match(
    sql,
    /IF NOT EXISTS \(\s*SELECT 1\s+FROM pg_constraint\s+WHERE conrelid = 'vercel_deployment_projections'::regclass[\s\S]*pg_get_constraintdef\(oid\)[\s\S]*PRIMARY KEY \(tenant_id, vercel_project_id, vercel_deployment_id\)[\s\S]*ADD PRIMARY KEY \(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id\);/i
  );
  assert.match(
    sql,
    /IF NOT EXISTS \(\s*SELECT 1\s+FROM pg_constraint\s+WHERE conrelid = 'vercel_failure_signals'::regclass[\s\S]*pg_get_constraintdef\(oid\)[\s\S]*PRIMARY KEY \(tenant_id, source_id\)[\s\S]*ADD PRIMARY KEY \(tenant_id,\s*source_id\);/i
  );
  assert.doesNotMatch(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_projects_global_project_team/i
  );
});

test("canonical hosted provisioning is versioned and idempotent across retries", async () => {
  const client = new FakeSchemaProvisioningClient();
  const reads: string[] = [];
  const readMigration = async (path: string) => {
    reads.push(path);
    return `-- canonical hosted schema: ${path}`;
  };

  await applyCanonicalHostedSchemaMigrations(client, readMigration);
  await applyCanonicalHostedSchemaMigrations(client, readMigration);

  assert.deepEqual(reads, [
    "migrations/005-hosted-canonical-contract.sql",
    "migrations/006-hosted-object-storage.sql",
    "migrations/007-hosted-workspace-members-and-invitations.sql",
  ]);
  assert.deepEqual(
    [...client.versions],
    [
      "005-hosted-canonical-contract.sql",
      "006-hosted-object-storage.sql",
      "007-hosted-workspace-members-and-invitations.sql",
    ]
  );
  assert.deepEqual(client.appliedSql, [
    "-- canonical hosted schema: migrations/005-hosted-canonical-contract.sql",
    "-- canonical hosted schema: migrations/006-hosted-object-storage.sql",
    "-- canonical hosted schema: migrations/007-hosted-workspace-members-and-invitations.sql",
  ]);
});

test("canonical hosted provisioning executes migration 005 against a database and retries cleanly", async () => {
  const db = await createPgLite();
  const client = pgLiteQueryable(db);
  try {
    await applyCanonicalHostedSchemaMigrations(client);
    const tableCheck = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('organizations', 'vercel_webhook_events', 'hosted_workspaces')`
    );
    assert.equal(Number(tableCheck.rows[0]?.count ?? 0), 3);
    await client.query("INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)", [
      "00000000-0000-0000-0000-000000000123",
      "Tenant round-trip",
      "org-round-trip",
    ]);
    const org = await client.query<{ name: string }>(
      "SELECT name FROM organizations WHERE clerk_org_id = $1",
      ["org-round-trip"]
    );
    assert.equal(org.rows[0]?.name, "Tenant round-trip");

    await applyCanonicalHostedSchemaMigrations(client);
    const migration = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version = $1",
      ["005-hosted-canonical-contract.sql"]
    );
    assert.equal(Number(migration.rows[0]?.count ?? 0), 1);
  } finally {
    await db.close();
  }
});

test("hosted workspace mutations delegate concurrency control to the shared provider", async () => {
  const provider = new TransactionalMemoryWorkspaceProvider();
  const firstInstance = new HostedWorkspaceStore("D:/instance-a", provider);
  const secondInstance = new HostedWorkspaceStore("D:/instance-b", provider);

  await Promise.all([
    firstInstance.create("alice", "Alice workspace"),
    secondInstance.create("bob", "Bob workspace"),
  ]);

  assert.equal((await provider.read()).users.alice.workspaces.length, 1);
  assert.equal((await provider.read()).users.bob.workspaces.length, 1);
});

test("hosted domain mutations delegate concurrency control to the shared provider", async () => {
  const workspaceProvider = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const workspaceStore = new HostedWorkspaceStore(process.cwd(), workspaceProvider);
  const workspace = await workspaceStore.create("alice", "Shared workspace");
  const domainProvider = new TransactionalMemoryDomainProvider();
  const firstInstance = new HostedDomainStore("D:/instance-a", workspaceStore, domainProvider);
  const secondInstance = new HostedDomainStore("D:/instance-b", workspaceStore, domainProvider);

  await Promise.all([
    firstInstance.putRecord("alice", workspace.id, "workItems", { title: "First" }),
    secondInstance.putRecord("alice", workspace.id, "workItems", { title: "Second" }),
  ]);

  const records = await domainProvider.read();
  assert.deepEqual(records.records[workspace.id].workItems?.map((record) => record.title).sort(), [
    "First",
    "Second",
  ]);
});

test("transactional hosted domain providers commit denied connector audits", async () => {
  const workspaceProvider = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const workspaceStore = new HostedWorkspaceStore(process.cwd(), workspaceProvider);
  const workspace = await workspaceStore.create("alice", "Audit workspace");
  const domainProvider = new TransactionalMemoryDomainProvider();
  const domainStore = new HostedDomainStore(process.cwd(), workspaceStore, domainProvider);
  const repository = await domainStore.registerRepository("alice", workspace.id, "D:/repos/audit");
  const connector = await domainStore.registerConnector("alice", workspace.id, 60_000);

  await assert.rejects(
    () =>
      domainStore.connectorRequest("alice", connector.id, workspace.id, repository.id, "git.read"),
    /not granted/
  );

  const audit = await domainStore.audit("alice", workspace.id);
  assert.equal(audit.at(-1)?.action, "connector.request");
  assert.equal(audit.at(-1)?.outcome, "denied");
});

test("production database configuration is explicit and credential encryption fails closed", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousUrl = environment.DEV_AGENTIC_OS_DATABASE_URL;
  const previousUnpooled = environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
  const previousStandardUrl = environment.DATABASE_URL;
  const previousStandardUnpooled = environment.DATABASE_URL_UNPOOLED;
  const previousKey = environment.DEV_AGENTIC_OS_SECRET_KEY;
  try {
    delete environment.DEV_AGENTIC_OS_DATABASE_URL;
    delete environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
    delete environment.DATABASE_URL;
    delete environment.DATABASE_URL_UNPOOLED;
    assert.throws(() => hostedDatabaseUrl(), /DEV_AGENTIC_OS_DATABASE_URL/);
    environment.DATABASE_URL = "postgresql://example.test/developer-os";
    assert.equal(hostedDatabaseUrl(), environment.DATABASE_URL);
    environment.DATABASE_URL_UNPOOLED = "postgresql://unpooled.example.test/developer-os";
    environment.DEV_AGENTIC_OS_DATABASE_URL = "postgresql://pooled.example.test/developer-os";
    assert.equal(hostedDatabaseUrl(), environment.DEV_AGENTIC_OS_DATABASE_URL);
    delete environment.DEV_AGENTIC_OS_SECRET_KEY;
    assert.throws(() => new EncryptedProtectedSecretStore(), /DEV_AGENTIC_OS_SECRET_KEY/);
    environment.DEV_AGENTIC_OS_SECRET_KEY = Buffer.alloc(32, 7).toString("base64url");
    const store = new EncryptedProtectedSecretStore();
    const reference = await store.put("secret-value");
    assert.equal(reference.includes("secret-value"), false);
    assert.equal(store.decrypt(reference), "secret-value");
  } finally {
    if (previousUrl === undefined) delete environment.DEV_AGENTIC_OS_DATABASE_URL;
    else environment.DEV_AGENTIC_OS_DATABASE_URL = previousUrl;
    if (previousUnpooled === undefined) delete environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
    else environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED = previousUnpooled;
    if (previousStandardUrl === undefined) delete environment.DATABASE_URL;
    else environment.DATABASE_URL = previousStandardUrl;
    if (previousStandardUnpooled === undefined) delete environment.DATABASE_URL_UNPOOLED;
    else environment.DATABASE_URL_UNPOOLED = previousStandardUnpooled;
    if (previousKey === undefined) delete environment.DEV_AGENTIC_OS_SECRET_KEY;
    else environment.DEV_AGENTIC_OS_SECRET_KEY = previousKey;
  }
});

test("hosted tenant stores reject production fallback when no canonical database is configured", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  const previousFixtureMode = environment.HOSTED_JSON_FIXTURE_MODE;
  const previousUrl = environment.DEV_AGENTIC_OS_DATABASE_URL;
  const previousUnpooled = environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
  const previousStandardUrl = environment.DATABASE_URL;
  const previousStandardUnpooled = environment.DATABASE_URL_UNPOOLED;
  try {
    environment.NODE_ENV = "production";
    delete environment.HOSTED_JSON_FIXTURE_MODE;
    delete environment.DEV_AGENTIC_OS_DATABASE_URL;
    delete environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
    delete environment.DATABASE_URL;
    delete environment.DATABASE_URL_UNPOOLED;
    assert.throws(
      () => hostedWorkspaceStoreForTenant(`workspace-${Date.now()}`),
      /Hosted runtime requires a supported database URL/
    );
    assert.throws(
      () => hostedDomainStoreForTenant(`domain-${Date.now()}`),
      /Hosted runtime requires a supported database URL/
    );
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
    if (previousFixtureMode === undefined) delete environment.HOSTED_JSON_FIXTURE_MODE;
    else environment.HOSTED_JSON_FIXTURE_MODE = previousFixtureMode;
    if (previousUrl === undefined) delete environment.DEV_AGENTIC_OS_DATABASE_URL;
    else environment.DEV_AGENTIC_OS_DATABASE_URL = previousUrl;
    if (previousUnpooled === undefined) delete environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
    else environment.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED = previousUnpooled;
    if (previousStandardUrl === undefined) delete environment.DATABASE_URL;
    else environment.DATABASE_URL = previousStandardUrl;
    if (previousStandardUnpooled === undefined) delete environment.DATABASE_URL_UNPOOLED;
    else environment.DATABASE_URL_UNPOOLED = previousStandardUnpooled;
  }
});

test("shared hosted tenant resolver rejects missing organization mappings", async () => {
  const missingTenantClient = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(
    () => resolveHostedTenantDatabaseId(missingTenantClient, "org_missing"),
    /org_missing.*not provisioned/i
  );
});

test("shared hosted tenant resolver returns the configured tenant id", async () => {
  const configuredTenantClient = {
    async query() {
      return { rows: [{ id: "tenant-123" }], rowCount: 1 };
    },
  };
  assert.equal(
    await resolveHostedTenantDatabaseId(configuredTenantClient, "org_configured"),
    "tenant-123"
  );
});

test("shared hosted tenant resolver rejects duplicate organization mappings", async () => {
  const duplicateTenantClient = {
    async query() {
      return { rows: [{ id: "tenant-123" }, { id: "tenant-456" }], rowCount: 2 };
    },
  };
  await assert.rejects(
    () => resolveHostedTenantDatabaseId(duplicateTenantClient, "org_duplicate"),
    /org_duplicate.*duplicate organization mappings/i
  );
});

test("hosted deployment reads fail closed until the organization is provisioned", async () => {
  const missingTenantClient = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
  const provider = Object.create(NeonHostedStateProvider.prototype) as {
    readDeploymentState(): Promise<unknown>;
    tenantId: string;
    ensureDeploymentSchema(): Promise<void>;
    transactionClient: { getStore(): typeof missingTenantClient };
    pool: typeof missingTenantClient;
  };
  provider.tenantId = "org_missing";
  provider.ensureDeploymentSchema = async () => undefined;
  provider.transactionClient = {
    getStore() {
      return missingTenantClient;
    },
  };
  provider.pool = missingTenantClient;
  await assert.rejects(() => provider.readDeploymentState(), /org_missing.*not provisioned/i);
});

test("production object storage rejects artifact bodies until durable storage is configured", async () => {
  const workspaceProvider = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const workspaceStore = new HostedWorkspaceStore(process.cwd(), workspaceProvider);
  const workspace = await workspaceStore.create("alice", "Production-shaped workspace");
  const domainStore = new HostedDomainStore(
    process.cwd(),
    workspaceStore,
    new MemoryDomainProvider(emptyDomainState()),
    new RejectingHostedObjectStore()
  );

  await assert.rejects(
    () =>
      domainStore.putRecord("alice", workspace.id, "artifacts", {
        name: "report",
        content: { value: 1 },
      }),
    /durable hosted object store/i
  );
});
