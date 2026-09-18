import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  applyCanonicalHostedSchemaMigrations,
  canonicalHostedSchemaMigrations,
  canonicalHostedSchemaTables,
} from "../src/server/hosted-persistence/canonical-hosted-schema";
import {
  EncryptedProtectedSecretStore,
  hostedDatabaseUrl,
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
const canonicalHostedMigrationPath = resolve(
  process.cwd(),
  "migrations/005-hosted-canonical-contract.sql"
);

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
    if (sql === "SELECT version FROM schema_migrations WHERE version = ANY($1::text[])") {
      const versions = ((values?.[0] as string[] | undefined) ?? []).filter((version) =>
        this.versions.has(version)
      );
      return {
        rowCount: versions.length,
        rows: versions.map((version) => ({ version })) as Row[],
      };
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

test("fresh hosted provisioning uses one authoritative contract migration", async () => {
  const sql = await readFile(canonicalHostedMigrationPath, "utf8");
  assert.deepEqual(canonicalHostedSchemaMigrations, ["migrations/005-hosted-canonical-contract.sql"]);
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
    /PRIMARY KEY\s+\(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id\)/i
  );
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_projects_global_project_team/i);
});

test("canonical hosted provisioning is versioned and idempotent across retries", async () => {
  const client = new FakeSchemaProvisioningClient();
  const reads: string[] = [];
  const readMigration = async (path: string) => {
    reads.push(path);
    return "-- canonical hosted schema";
  };

  await applyCanonicalHostedSchemaMigrations(client, readMigration);
  await applyCanonicalHostedSchemaMigrations(client, readMigration);

  assert.deepEqual(reads, ["migrations/005-hosted-canonical-contract.sql"]);
  assert.deepEqual([...client.versions].sort(), [
    "005-hosted-canonical-contract",
    "005-hosted-canonical-contract.sql",
  ]);
  assert.deepEqual(client.appliedSql, ["-- canonical hosted schema"]);
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
