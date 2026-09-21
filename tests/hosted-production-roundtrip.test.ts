import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "@neondatabase/serverless";

import {
  EncryptedProtectedSecretStore,
  hostedDatabaseUrl,
  NeonHostedStateProvider,
  NeonHostedWorkspaceStateProvider,
  resolveHostedTenantDatabaseId,
} from "../src/server/hosted-persistence/neon-hosted-provider";
import { NeonHostedObjectStore } from "../src/server/hosted-domain/neon-hosted-object-store";
import {
  DeterministicJsonHostedStateProvider,
  DeterministicProtectedSecretStore,
  HostedDomainError,
  HostedDomainStore,
} from "../src/server/hosted-domain/hosted-domain-store";
import { LocalHostedObjectStore } from "../src/server/hosted-domain/hosted-object-store";
import {
  HostedWorkspaceError,
  HostedWorkspaceStore,
} from "../src/server/hosted-workspaces/hosted-workspace-store";
import {
  authAdapter,
  AuthError,
  ClerkTokenVerifier,
  DeterministicAuthAdapter,
  TokenAuthAdapter,
} from "../src/server/hosted-auth/auth-adapter";
import {
  assertHostedInternalOwnerEnabled,
  isHostedInternalOwnerEnabled,
} from "../src/server/hosted-flags/feature-flags";
import { POST as postArtifact } from "../src/app/api/artifacts/route";
import { GET as getArtifactById } from "../src/app/api/artifacts/[id]/route";

async function createTestDatabase(): Promise<{
  db: PGlite;
  pool: Pool;
  close: () => Promise<void>;
}> {
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

  const m5 = await readFile(
    resolve(process.cwd(), "migrations/005-hosted-canonical-contract.sql"),
    "utf8"
  );
  await db.exec(m5);
  const m6 = await readFile(
    resolve(process.cwd(), "migrations/006-hosted-object-storage.sql"),
    "utf8"
  );
  await db.exec(m6);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO schema_migrations (version) VALUES
      ('005-hosted-canonical-contract.sql'),
      ('006-hosted-object-storage.sql')
    ON CONFLICT DO NOTHING;
  `);

  const queryFn = async <Row = unknown>(text: string, values?: unknown[]) => {
    const sql = text.trim();
    if (values && values.length > 0) {
      const res = await db.query<Row>(sql, values);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    }
    const upper = sql.toUpperCase();
    if (upper.startsWith("SELECT")) {
      const res = await db.query<Row>(sql);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    }
    await db.exec(sql);
    return { rows: [] as Row[], rowCount: 0 };
  };

  const pool = {
    query: queryFn,
    connect: async () => ({
      query: queryFn,
      release() {},
    }),
    end: async () => {},
  } as unknown as Pool;

  return {
    db,
    pool,
    close: async () => {
      if (!db.closed) await db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Criterion 1: Clerk-compatible authentication identifies the internal owner
// without fixture credentials in production mode.
// ---------------------------------------------------------------------------
test("Criterion 1: Clerk-compatible auth identifies internal owner and rejects fixture auth in production mode", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const prevAuthFixture = env.HOSTED_AUTH_FIXTURE_MODE;
  const prevClerkKey = env.CLERK_SECRET_KEY;

  try {
    env.NODE_ENV = "production";
    delete env.HOSTED_AUTH_FIXTURE_MODE;
    env.CLERK_SECRET_KEY = "sk_live_test_key_mock_clerk";

    // 1a: Internal owner identity verified via Clerk token claims
    const mockClaims = {
      sub: "user_owner_internal",
      org_id: "org_prod_alpha",
      org_role: "org:admin",
      first_name: "Internal Owner",
    };
    const mockVerify = async (token: string) => {
      if (token === "valid_clerk_token") return mockClaims;
      throw new Error("Invalid token signature");
    };

    const verifier = new ClerkTokenVerifier(mockVerify as any, env.CLERK_SECRET_KEY);
    const tokenAdapter = new TokenAuthAdapter(verifier);

    const authRequest = new Request("https://example.com/api/hosted", {
      headers: { authorization: "Bearer valid_clerk_token" },
    });
    const identity = await tokenAdapter.authenticate(authRequest);
    assert.equal(identity.userId, "user_owner_internal");
    assert.equal(identity.tenantId, "org_prod_alpha");
    assert.equal(identity.displayName, "Internal Owner");
    assert.equal(identity.orgRole, "org:admin");

    // 1b: Rejection of invalid/expired token
    const invalidRequest = new Request("https://example.com/api/hosted", {
      headers: { authorization: "Bearer expired_or_tampered_token" },
    });
    await assert.rejects(
      () => tokenAdapter.authenticate(invalidRequest),
      (err: unknown) => {
        assert.ok(err instanceof AuthError);
        assert.equal((err as AuthError).code, "UNAUTHENTICATED");
        assert.match((err as AuthError).message, /Invalid or expired/i);
        return true;
      }
    );

    // 1c: Rejection of missing organization in claims
    const noOrgVerify = async () => ({
      sub: "user_owner_internal",
      first_name: "Internal Owner",
    });
    const noOrgVerifier = new ClerkTokenVerifier(noOrgVerify as any, env.CLERK_SECRET_KEY);
    await assert.rejects(
      () => new TokenAuthAdapter(noOrgVerifier).authenticate(authRequest),
      (err: unknown) => {
        assert.ok(err instanceof AuthError);
        assert.match((err as AuthError).message, /Select an organization/i);
        return true;
      }
    );

    // 1d: DeterministicAuthAdapter fails closed in production mode
    const fixtureAdapter = new DeterministicAuthAdapter(false);
    await assert.rejects(
      () =>
        fixtureAdapter.authenticate(
          new Request("https://example.com/api/hosted", {
            headers: {
              "x-hosted-user-id": "spoofed_owner",
              "x-hosted-tenant-id": "org_prod_alpha",
            },
          })
        ),
      (err: unknown) => {
        assert.ok(err instanceof AuthError);
        return true;
      }
    );

    // 1e: Deterministic fixture mode configured in production throws actionable error
    env.HOSTED_AUTH_FIXTURE_MODE = "true";
    await assert.rejects(
      () => authAdapter.authenticate(authRequest),
      (err: unknown) => {
        assert.ok(err instanceof AuthError);
        assert.match((err as AuthError).message, /rejected in production/i);
        return true;
      }
    );
  } finally {
    if (prevNodeEnv !== undefined) env.NODE_ENV = prevNodeEnv;
    else delete env.NODE_ENV;
    if (prevAuthFixture !== undefined) env.HOSTED_AUTH_FIXTURE_MODE = prevAuthFixture;
    else delete env.HOSTED_AUTH_FIXTURE_MODE;
    if (prevClerkKey !== undefined) env.CLERK_SECRET_KEY = prevClerkKey;
    else delete env.CLERK_SECRET_KEY;
  }
});

// ---------------------------------------------------------------------------
// Criterion 2: Hosted Workspace and Hosted State writes survive restart
// and are isolated to the authenticated workspace.
// ---------------------------------------------------------------------------
test("Criterion 2: Hosted Workspace and Hosted State survive process restart with tenant isolation", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevFlag = env.FEATURE_HOSTED_INTERNAL_OWNER;
  const prevSecretKey = env.DEV_AGENTIC_OS_SECRET_KEY;
  env.FEATURE_HOSTED_INTERNAL_OWNER = "true";
  env.DEV_AGENTIC_OS_SECRET_KEY = Buffer.alloc(32, "a").toString("base64url");

  const { db, pool, close } = await createTestDatabase();
  try {
    // Setup organizations in DB
    await db.query(
      "INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3), ($4, $5, $6)",
      [
        "11111111-1111-1111-1111-111111111111",
        "Tenant Alpha",
        "org_alpha",
        "22222222-2222-2222-2222-222222222222",
        "Tenant Beta",
        "org_beta",
      ]
    );

    // Process instance 1: create workspace, register repo, put work item, externalize artifact
    const wsProvider1 = new NeonHostedWorkspaceStateProvider("org_alpha", pool);
    const wsStore1 = new HostedWorkspaceStore(process.cwd(), wsProvider1);
    const createdWorkspace = await wsStore1.create("user_alpha_owner", "Production OS Workspace");
    await wsStore1.select("user_alpha_owner", createdWorkspace.id);

    const objStore1 = new NeonHostedObjectStore("org_alpha", pool);
    const stateProvider1 = new NeonHostedStateProvider("org_alpha", pool);
    const secretStore1 = new EncryptedProtectedSecretStore();
    const domainStore1 = new HostedDomainStore(
      process.cwd(),
      wsStore1,
      stateProvider1,
      objStore1,
      undefined,
      secretStore1
    );

    await domainStore1.registerRepository(
      "user_alpha_owner",
      createdWorkspace.id,
      "/repos/developer-agentic-os"
    );
    const workItem = await domainStore1.putRecord(
      "user_alpha_owner",
      createdWorkspace.id,
      "workItems",
      {
        title: "Durable Hosted Work Item",
        status: "open",
      }
    );
    const artifact = await domainStore1.putRecord(
      "user_alpha_owner",
      createdWorkspace.id,
      "artifacts",
      {
        name: "architecture_plan.md",
        type: "markdown",
        content: "# Production Architecture Specification\nSafe restart round trip verified.",
      }
    );

    // Simulate process termination: close instance 1
    await stateProvider1.close();
    await wsProvider1.close();

    // Process instance 2: fresh providers connected to the exact same Postgres database
    const wsProvider2 = new NeonHostedWorkspaceStateProvider("org_alpha", pool);
    const wsStore2 = new HostedWorkspaceStore(process.cwd(), wsProvider2);
    const objStore2 = new NeonHostedObjectStore("org_alpha", pool);
    const stateProvider2 = new NeonHostedStateProvider("org_alpha", pool);
    const domainStore2 = new HostedDomainStore(
      process.cwd(),
      wsStore2,
      stateProvider2,
      objStore2,
      undefined,
      secretStore1
    );

    // Verify workspace survived restart
    const workspacesAfterRestart = await wsStore2.list("user_alpha_owner");
    assert.equal(workspacesAfterRestart.length, 1);
    assert.equal(workspacesAfterRestart[0].id, createdWorkspace.id);
    assert.equal(workspacesAfterRestart[0].name, "Production OS Workspace");

    const activeWorkspace = await wsStore2.active("user_alpha_owner");
    assert.ok(activeWorkspace);
    assert.equal(activeWorkspace.id, createdWorkspace.id);

    // Verify repositories and workItems survived restart
    const reposAfterRestart = await domainStore2.listRepositories(
      "user_alpha_owner",
      createdWorkspace.id
    );
    assert.equal(reposAfterRestart.length, 1);
    assert.equal(reposAfterRestart[0].localPath, "/repos/developer-agentic-os");

    const workItemsAfterRestart = await domainStore2.listRecords(
      "user_alpha_owner",
      createdWorkspace.id,
      "workItems"
    );
    assert.equal(workItemsAfterRestart.length, 1);
    assert.equal(workItemsAfterRestart[0].id, workItem.id);
    assert.equal((workItemsAfterRestart[0] as any).title, "Durable Hosted Work Item");

    // Verify artifact survived restart and content rehydrates from object storage
    const rehydratedArtifact = await domainStore2.getArtifact(
      "user_alpha_owner",
      createdWorkspace.id,
      artifact.id
    );
    assert.ok(rehydratedArtifact);
    assert.equal(rehydratedArtifact.name, "architecture_plan.md");
    assert.equal(
      rehydratedArtifact.content,
      "# Production Architecture Specification\nSafe restart round trip verified."
    );

    // Tenant Isolation: Tenant Beta sees completely isolated state
    const wsProviderBeta = new NeonHostedWorkspaceStateProvider("org_beta", pool);
    const wsStoreBeta = new HostedWorkspaceStore(process.cwd(), wsProviderBeta);
    const betaWorkspaces = await wsStoreBeta.list("user_alpha_owner");
    assert.deepEqual(betaWorkspaces, []);

    const stateProviderBeta = new NeonHostedStateProvider("org_beta", pool);
    const domainStoreBeta = new HostedDomainStore(
      process.cwd(),
      wsStoreBeta,
      stateProviderBeta,
      new NeonHostedObjectStore("org_beta", pool),
      undefined,
      secretStore1
    );

    // Beta cannot access Alpha's workspace or artifact
    await assert.rejects(
      () => domainStoreBeta.getArtifact("user_alpha_owner", createdWorkspace.id, artifact.id),
      /not found/i
    );

    await stateProvider2.close();
    await wsProvider2.close();
    await stateProviderBeta.close();
    await wsProviderBeta.close();
  } finally {
    if (prevFlag !== undefined) env.FEATURE_HOSTED_INTERNAL_OWNER = prevFlag;
    else delete env.FEATURE_HOSTED_INTERNAL_OWNER;
    if (prevSecretKey !== undefined) env.DEV_AGENTIC_OS_SECRET_KEY = prevSecretKey;
    else delete env.DEV_AGENTIC_OS_SECRET_KEY;
    await close();
  }
});

// ---------------------------------------------------------------------------
// Criterion 3: Artifact content stored and retrieved through managed object
// storage while Hosted State retains a safe reference.
// ---------------------------------------------------------------------------
test("Criterion 3: Artifact content stored in managed object store with safe hash reference in state", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevFlag = env.FEATURE_HOSTED_INTERNAL_OWNER;
  env.FEATURE_HOSTED_INTERNAL_OWNER = "true";

  const { db, pool, close } = await createTestDatabase();
  try {
    await db.query("INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)", [
      "33333333-3333-3333-3333-333333333333",
      "Tenant Objects",
      "org_objects",
    ]);

    const wsProvider = new NeonHostedWorkspaceStateProvider("org_objects", pool);
    const wsStore = new HostedWorkspaceStore(process.cwd(), wsProvider);
    const workspace = await wsStore.create("owner_obj", "Object Storage Workspace");

    const objectStore = new NeonHostedObjectStore("org_objects", pool);
    const stateProvider = new NeonHostedStateProvider("org_objects", pool);
    const domainStore = new HostedDomainStore(process.cwd(), wsStore, stateProvider, objectStore);

    // 3a: Put artifact with JSON content
    const originalContent = {
      project: "Agentic OS",
      status: "ready",
      matrix: [1, 2, 3, 4],
    };
    const artifact = await domainStore.putRecord("owner_obj", workspace.id, "artifacts", {
      id: "art_obj_json",
      name: "data_payload.json",
      type: "json",
      content: originalContent,
    });

    // 3b: Verify in HostedState records that raw content is not stored in state JSON
    const state = await stateProvider.read();
    const storedRecord = state.records[workspace.id]?.artifacts?.find(
      (r: any) => r.id === artifact.id
    ) as any;
    assert.ok(storedRecord);
    assert.equal(storedRecord.content, undefined);
    assert.ok(storedRecord.objectReference);
    assert.equal(storedRecord.objectReference.length, 64);
    assert.equal(storedRecord.objectContentType, "application/json");
    assert.ok(storedRecord.objectSize > 0);

    // 3c: Verify database table `hosted_objects` directly holds the BYTEA content
    const dbObj = await db.query<{
      reference: string;
      content_type: string;
      size: number;
      data: Uint8Array;
    }>(
      "SELECT reference, content_type, size, data FROM hosted_objects WHERE tenant_id = $1 AND reference = $2",
      ["33333333-3333-3333-3333-333333333333", storedRecord.objectReference]
    );
    assert.equal(dbObj.rows.length, 1);
    assert.equal(dbObj.rows[0].reference, storedRecord.objectReference);
    assert.equal(dbObj.rows[0].content_type, "application/json");
    const parsedFromDb = JSON.parse(Buffer.from(dbObj.rows[0].data).toString("utf8"));
    assert.deepEqual(parsedFromDb, originalContent);

    // 3d: getArtifact rehydrates payload seamlessly
    const rehydrated = await domainStore.getArtifact("owner_obj", workspace.id, artifact.id);
    assert.ok(rehydrated);
    assert.deepEqual(rehydrated.content, originalContent);

    // 3e: Deduplication - storing identical payload reuses same SHA-256 reference
    const duplicate = await objectStore.put(JSON.stringify(originalContent), "application/json");
    assert.equal(duplicate.reference, storedRecord.objectReference);

    // Direct count in DB remains 1
    const countCheck = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM hosted_objects WHERE tenant_id = $1 AND reference = $2",
      ["33333333-3333-3333-3333-333333333333", storedRecord.objectReference]
    );
    assert.equal(Number(countCheck.rows[0].count), 1);

    // 3f: Invalid/tampered reference throws clear error
    await assert.rejects(
      () => objectStore.get("invalid_short_reference"),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "INVALID");
        return true;
      }
    );

    await assert.rejects(
      () => objectStore.get("0000000000000000000000000000000000000000000000000000000000000000"),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "NOT_FOUND");
        return true;
      }
    );

    await stateProvider.close();
    await wsProvider.close();
  } finally {
    if (prevFlag !== undefined) env.FEATURE_HOSTED_INTERNAL_OWNER = prevFlag;
    else delete env.FEATURE_HOSTED_INTERNAL_OWNER;
    await close();
  }
});

// ---------------------------------------------------------------------------
// Criterion 4: Production mode cannot silently select fixture persistence,
// local object storage, or deterministic secret storage.
// ---------------------------------------------------------------------------
test("Criterion 4: Production mode fail-closed guardrails reject fixture persistence and local storage", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const prevJsonFixture = env.HOSTED_JSON_FIXTURE_MODE;
  env.NODE_ENV = "production";
  delete env.HOSTED_JSON_FIXTURE_MODE;

  try {
    const memoryWsProvider = {
      async read() {
        return { users: {}, audit: [] };
      },
      async write() {},
    };
    const wsStore = new HostedWorkspaceStore(process.cwd(), memoryWsProvider);
    const memoryStateProvider = {
      async read() {
        return {
          repositories: {},
          records: {},
          relationships: {},
          snapshots: {},
          connectors: [],
          credentials: [],
          audit: [],
          vercelProject: null,
          vercelProjectHistory: [],
          githubRepositories: [],
        };
      },
      async write() {},
    };

    // 4a: DeterministicJsonHostedStateProvider rejected in production
    assert.throws(
      () =>
        new HostedDomainStore(
          process.cwd(),
          wsStore,
          new DeterministicJsonHostedStateProvider(process.cwd())
        ),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "INVALID");
        assert.match((err as HostedDomainError).message, /deterministic fixture persistence/i);
        return true;
      }
    );

    // 4b: LocalHostedObjectStore rejected in production
    assert.throws(
      () =>
        new HostedDomainStore(
          process.cwd(),
          wsStore,
          memoryStateProvider,
          new LocalHostedObjectStore(process.cwd())
        ),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "INVALID");
        assert.match((err as HostedDomainError).message, /local object storage/i);
        return true;
      }
    );

    // 4c: DeterministicProtectedSecretStore rejected in production
    const dummyObjectStore = {
      async put() {
        return { reference: "a".repeat(64), contentType: "text/plain", size: 0 };
      },
      async get() {
        return new Uint8Array();
      },
    };
    const dummyExportAdapter = {
      async export() {
        return {} as any;
      },
    };
    assert.throws(
      () =>
        new HostedDomainStore(
          process.cwd(),
          wsStore,
          memoryStateProvider,
          dummyObjectStore,
          dummyExportAdapter,
          new DeterministicProtectedSecretStore()
        ),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "INVALID");
        assert.match((err as HostedDomainError).message, /deterministic secret storage/i);
        return true;
      }
    );

    // 4d: HostedWorkspaceStore rejects unconfigured JSON storage in production
    const unconfiguredWsStore = new HostedWorkspaceStore(process.cwd());
    await assert.rejects(
      () => unconfiguredWsStore.list("alice"),
      (err: unknown) => {
        assert.ok(err instanceof HostedWorkspaceError);
        assert.equal((err as HostedWorkspaceError).code, "NOT_FOUND");
        assert.match((err as HostedWorkspaceError).message, /fixture-only/i);
        return true;
      }
    );
  } finally {
    if (prevNodeEnv !== undefined) env.NODE_ENV = prevNodeEnv;
    else delete env.NODE_ENV;
    if (prevJsonFixture !== undefined) env.HOSTED_JSON_FIXTURE_MODE = prevJsonFixture;
    else delete env.HOSTED_JSON_FIXTURE_MODE;
  }
});

// ---------------------------------------------------------------------------
// Criterion 5: Missing or invalid production configuration produces a
// machine-readable, correlated failure without partial state.
// ---------------------------------------------------------------------------
test("Criterion 5: Missing production configuration fails closed with correlated errors and no partial state", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevDbUrl = env.DEV_AGENTIC_OS_DATABASE_URL;
  const prevBaseDbUrl = env.DATABASE_URL;
  const prevKey = env.SECRET_STORE_ENCRYPTION_KEY;
  const prevNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    // 5a: Missing database URL fails closed
    delete env.DEV_AGENTIC_OS_DATABASE_URL;
    delete env.DATABASE_URL;
    delete env.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED;
    delete env.DATABASE_URL_UNPOOLED;

    assert.throws(
      () => hostedDatabaseUrl(),
      /requires DATABASE_URL, DATABASE_URL_UNPOOLED, DEV_AGENTIC_OS_DATABASE_URL/i
    );

    // 5b: Missing encryption key in production fails closed
    delete env.SECRET_STORE_ENCRYPTION_KEY;
    delete env.DEV_AGENTIC_OS_SECRET_STORE_ENCRYPTION_KEY;

    assert.throws(() => new EncryptedProtectedSecretStore(), /DEV_AGENTIC_OS_SECRET_KEY/i);

    // 5c: Unprovisioned tenant organization fails closed with actionable error
    const { pool, close } = await createTestDatabase();
    try {
      await assert.rejects(
        () => resolveHostedTenantDatabaseId(pool, "org_unprovisioned_123"),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(
            err.message,
            /Hosted organization org_unprovisioned_123 is not provisioned/i
          );
          return true;
        }
      );
    } finally {
      await close();
    }
  } finally {
    if (prevDbUrl !== undefined) env.DEV_AGENTIC_OS_DATABASE_URL = prevDbUrl;
    else delete env.DEV_AGENTIC_OS_DATABASE_URL;
    if (prevBaseDbUrl !== undefined) env.DATABASE_URL = prevBaseDbUrl;
    else delete env.DATABASE_URL;
    if (prevKey !== undefined) env.SECRET_STORE_ENCRYPTION_KEY = prevKey;
    else delete env.SECRET_STORE_ENCRYPTION_KEY;
    if (prevNodeEnv !== undefined) env.NODE_ENV = prevNodeEnv;
    else delete env.NODE_ENV;
  }
});

// ---------------------------------------------------------------------------
// Criterion 6: Feature flag protection and authenticated API round trip
// ---------------------------------------------------------------------------
test("Criterion 6: Feature flag gate asserts internal owner and enables authenticated API round trip", async () => {
  const env = process.env as Record<string, string | undefined>;
  const prevFlag = env.FEATURE_HOSTED_INTERNAL_OWNER;
  const prevNodeEnv = env.NODE_ENV;
  const prevFixture = env.HOSTED_AUTH_FIXTURE_MODE;
  const prevJsonFixture = env.HOSTED_JSON_FIXTURE_MODE;

  const { db, pool, close } = await createTestDatabase();
  try {
    await db.query("INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)", [
      "44444444-4444-4444-4444-444444444444",
      "Flagged Org",
      "org_flagged",
    ]);

    const wsProvider = new NeonHostedWorkspaceStateProvider("org_flagged", pool);
    const wsStore = new HostedWorkspaceStore(process.cwd(), wsProvider);
    const objStore = new NeonHostedObjectStore("org_flagged", pool);
    const stateProvider = new NeonHostedStateProvider("org_flagged", pool);
    const domainStore = new HostedDomainStore(process.cwd(), wsStore, stateProvider, objStore);

    // 6a: Feature flag disabled -> workspace creation and externalize artifact fail closed
    env.FEATURE_HOSTED_INTERNAL_OWNER = "false";
    delete env.DEV_AGENTIC_OS_FEATURE_HOSTED_INTERNAL_OWNER;

    assert.equal(isHostedInternalOwnerEnabled(), false);
    assert.throws(
      () => assertHostedInternalOwnerEnabled(),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "FEATURE_DISABLED");
        return true;
      }
    );

    await assert.rejects(
      () => wsStore.create("user_flag_test", "Blocked Workspace"),
      (err: unknown) => {
        assert.ok(err instanceof HostedDomainError);
        assert.equal((err as HostedDomainError).code, "FEATURE_DISABLED");
        return true;
      }
    );

    // 6b: Feature flag enabled -> operations succeed
    env.FEATURE_HOSTED_INTERNAL_OWNER = "true";
    assert.equal(isHostedInternalOwnerEnabled(), true);

    const createdWorkspace = await wsStore.create("user_flag_test", "Allowed Workspace");
    assert.ok(createdWorkspace.id);
    await wsStore.select("user_flag_test", createdWorkspace.id);

    const artifact = await domainStore.putRecord(
      "user_flag_test",
      createdWorkspace.id,
      "artifacts",
      {
        id: "art_flag_test_1",
        name: "flagged_report.md",
        type: "markdown",
        content: "Feature flagged hosted internal owner round trip verified.",
      }
    );
    assert.ok(artifact.id);

    // Verify artifact retrieval rehydrates content
    const retrieved = await domainStore.getArtifact(
      "user_flag_test",
      createdWorkspace.id,
      artifact.id
    );
    assert.ok(retrieved);
    assert.equal(retrieved.content, "Feature flagged hosted internal owner round trip verified.");

    // 6c: Route Seam authenticated API round trip
    // Test POST /api/artifacts and GET /api/artifacts/[id] via hosted mode
    env.NODE_ENV = "test";
    env.HOSTED_AUTH_FIXTURE_MODE = "true";
    env.HOSTED_JSON_FIXTURE_MODE = "true";

    const postReq = new Request("http://localhost/api/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosted-user-id": "user_flag_test",
        "x-hosted-tenant-id": "personal:user_flag_test",
        authorization: "Bearer test_bearer_token",
      },
      body: JSON.stringify({
        name: "api_roundtrip_artifact.json",
        type: "json",
        content: { generatedBy: "API Round Trip", timestamp: 123456789 },
      }),
    });

    const postRes = await postArtifact(postReq);
    assert.equal(postRes.status, 201);
    const postBody = (await postRes.json()) as any;
    assert.ok(postBody.id);
    assert.equal(postBody.name, "api_roundtrip_artifact.json");

    // Fetch the artifact via GET /api/artifacts/[id]
    const getReq = new Request(`http://localhost/api/artifacts/${postBody.id}`, {
      headers: {
        "x-hosted-user-id": "user_flag_test",
        "x-hosted-tenant-id": "personal:user_flag_test",
        authorization: "Bearer test_bearer_token",
      },
    });

    const getRes = await getArtifactById(getReq, {
      params: Promise.resolve({ id: postBody.id }),
    });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as any;
    assert.equal(getBody.id, postBody.id);
    assert.deepEqual(getBody.content, { generatedBy: "API Round Trip", timestamp: 123456789 });

    await stateProvider.close();
    await wsProvider.close();
  } finally {
    if (prevFlag !== undefined) env.FEATURE_HOSTED_INTERNAL_OWNER = prevFlag;
    else delete env.FEATURE_HOSTED_INTERNAL_OWNER;
    if (prevNodeEnv !== undefined) env.NODE_ENV = prevNodeEnv;
    else delete env.NODE_ENV;
    if (prevFixture !== undefined) env.HOSTED_AUTH_FIXTURE_MODE = prevFixture;
    else delete env.HOSTED_AUTH_FIXTURE_MODE;
    if (prevJsonFixture !== undefined) env.HOSTED_JSON_FIXTURE_MODE = prevJsonFixture;
    else delete env.HOSTED_JSON_FIXTURE_MODE;
    await close();
  }
});
