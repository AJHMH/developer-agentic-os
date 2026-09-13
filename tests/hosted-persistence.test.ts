import assert from "node:assert/strict";
import test from "node:test";

import {
  EncryptedProtectedSecretStore,
  hostedDatabaseUrl,
} from "../src/server/hosted-persistence/neon-hosted-provider";
import {
  assertCanonicalHostedPersistenceContract,
  hostedPersistenceContract,
} from "../src/server/hosted-persistence/hosted-persistence-contract";
import {
  migrateHostedTenant,
  type HostedMigrationStatus,
} from "../src/server/hosted-persistence/hosted-migration";
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
import { HostedWorkspaceStore } from "../src/server/hosted-workspaces/hosted-workspace-store";

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

test("hosted persistence exposes one tenant-scoped canonical contract", () => {
  assertCanonicalHostedPersistenceContract();
  assert.equal(hostedPersistenceContract.name, "tenant-scoped-hosted-provider");
  assert.equal(hostedPersistenceContract.tenantKey, "tenant_id");
  assert.equal(
    hostedPersistenceContract.compatibility,
    "normalized-migration-tables-are-legacy-input-only"
  );
  assert.deepEqual(hostedPersistenceContract.stateTables, [
    "developer_agentic_os_hosted_state",
    "developer_agentic_os_workspace_state",
  ]);
});

test("hosted tenant migration is retry-safe and records completion provenance", async () => {
  const sourceState = new MemoryDomainProvider({
    ...emptyDomainState(),
    audit: [
      {
        id: "audit",
        userId: "alice",
        workspaceId: "workspace-a",
        action: "migration.source",
        occurredAt: "2026-09-12T00:00:00.000Z",
      },
    ],
  });
  const sourceWorkspace = new MemoryWorkspaceProvider({
    users: { alice: { workspaces: [], activeWorkspaceId: null } },
    audit: [],
  });
  const targetState = new MemoryDomainProvider(emptyDomainState());
  const targetWorkspace = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const statuses = new Map<string, Awaited<ReturnType<typeof migrateHostedTenant>>["status"]>();
  const status = {
    read: async (tenantId: string) => statuses.get(tenantId) ?? null,
    write: async (value: Awaited<ReturnType<typeof migrateHostedTenant>>["status"]) => {
      statuses.set(value.tenantId, value);
    },
  };

  const input = {
    tenantId: "tenant-a",
    source: { state: sourceState, workspace: sourceWorkspace },
    target: { state: targetState, workspace: targetWorkspace },
    status,
    sourceName: "legacy-hosted-state",
    targetName: "tenant-scoped-hosted-provider",
    version: 1,
    now: () => "2026-09-12T00:00:00.000Z",
  };
  const first = await migrateHostedTenant(input);
  const second = await migrateHostedTenant(input);

  assert.equal(first.status.state, "completed");
  assert.equal(second.status.state, "completed");
  assert.equal(second.status.startedAt, first.status.startedAt);
  assert.deepEqual(await targetState.read(), await sourceState.read());
  assert.deepEqual(await targetWorkspace.read(), await sourceWorkspace.read());
});

test("hosted tenant migration records a failed attempt without changing its tenant", async () => {
  const sourceState = new MemoryDomainProvider(emptyDomainState());
  const sourceWorkspace = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const targetState = new MemoryDomainProvider(emptyDomainState());
  const targetWorkspace = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const statuses = new Map<string, HostedMigrationStatus>();
  const status = {
    read: async (tenantId: string) => statuses.get(tenantId) ?? null,
    write: async (value: HostedMigrationStatus) => {
      statuses.set(value.tenantId, value);
    },
  };
  const failingState: HostedStateProvider = {
    read: () => targetState.read(),
    write: async () => {
      throw new Error("target unavailable");
    },
  };
  const failingTarget = {
    state: failingState,
    workspace: targetWorkspace,
  };

  await assert.rejects(
    () =>
      migrateHostedTenant({
        tenantId: "tenant-b",
        source: { state: sourceState, workspace: sourceWorkspace },
        target: failingTarget,
        status,
        sourceName: "legacy-hosted-state",
        targetName: "tenant-scoped-hosted-provider",
        version: 1,
      }),
    /target unavailable/
  );
  assert.equal(statuses.get("tenant-b")?.state, "failed");
  assert.equal(statuses.get("tenant-b")?.tenantId, "tenant-b");
  assert.equal(statuses.get("tenant-b")?.error, "target unavailable");
  assert.equal(statuses.has("tenant-a"), false);
});

test("hosted tenant migration restores state when the workspace write fails", async () => {
  const sourceState = new MemoryDomainProvider({ ...emptyDomainState(), records: { source: {} } });
  const sourceWorkspace = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const originalState: HostedState = { ...emptyDomainState(), records: { original: {} } };
  const targetState = new MemoryDomainProvider(originalState);
  const targetWorkspace = new MemoryWorkspaceProvider(emptyWorkspaceState());
  const statuses = new Map<string, HostedMigrationStatus>();
  const status = {
    read: async (tenantId: string) => statuses.get(tenantId) ?? null,
    write: async (value: HostedMigrationStatus) => {
      statuses.set(value.tenantId, value);
    },
  };
  const failingWorkspace: HostedWorkspaceStateProvider = {
    read: () => targetWorkspace.read(),
    write: async () => {
      throw new Error("workspace unavailable");
    },
  };

  await assert.rejects(
    () =>
      migrateHostedTenant({
        tenantId: "tenant-c",
        source: { state: sourceState, workspace: sourceWorkspace },
        target: { state: targetState, workspace: failingWorkspace },
        status,
        sourceName: "legacy-hosted-state",
        targetName: "tenant-scoped-hosted-provider",
        version: 1,
      }),
    /workspace unavailable/
  );
  assert.deepEqual(await targetState.read(), originalState);
  assert.equal(statuses.get("tenant-c")?.state, "failed");
});

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
