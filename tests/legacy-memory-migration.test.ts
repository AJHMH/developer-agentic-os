import assert from "node:assert/strict";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import {
  GET as getLegacyMigrationRoute,
  POST as postLegacyMigrationRoute,
} from "../src/app/api/hosted/domain/legacy-migration/route";
import {
  HostedDomainStore,
  setHostedDomainStoreForTenant,
} from "../src/server/hosted-domain/hosted-domain-store";
import {
  LEGACY_MEMORY_DIR,
  detectLegacyMemory,
  executeMigration,
  listLegacyJsonFiles,
  preflight,
} from "../src/server/hosted-domain/legacy-memory-migrator";
import {
  HostedWorkspaceStore,
  setHostedWorkspaceStoreForTenant,
} from "../src/server/hosted-workspaces/hosted-workspace-store";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function withEnv<T>(
  callback: (opts: { root: string; store: HostedDomainStore }) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-legacy-migration-"));
  try {
    return await callback({ root, store: new HostedDomainStore(root) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedLegacyMemory(
  root: string,
  opts: {
    workItems?: unknown[];
    incomingSignals?: unknown[];
    operational?: {
      incidents?: unknown[];
      runs?: unknown[];
      audits?: unknown[];
    };
    artifacts?: unknown[];
    extraFiles?: Array<{ name: string; content: string }>;
  } = {}
): Promise<string> {
  const memDir = join(root, LEGACY_MEMORY_DIR);
  await mkdir(memDir, { recursive: true });
  await mkdir(join(memDir, "artifacts"), { recursive: true });

  if (opts.workItems !== undefined) {
    await writeFile(join(memDir, "work-items.json"), JSON.stringify(opts.workItems));
  }
  if (opts.incomingSignals !== undefined) {
    await writeFile(join(memDir, "incoming-signals.json"), JSON.stringify(opts.incomingSignals));
  }
  if (opts.operational !== undefined) {
    await writeFile(join(memDir, "operational.json"), JSON.stringify(opts.operational));
  }
  if (opts.artifacts !== undefined) {
    await writeFile(
      join(memDir, "artifacts/index.json"),
      JSON.stringify({ artifacts: opts.artifacts })
    );
  }
  for (const extra of opts.extraFiles ?? []) {
    await writeFile(join(memDir, extra.name), extra.content);
  }
  return memDir;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1: Detection — detects when present, reports absent when not, no import
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC1: detectLegacyMemory returns detected=true when .memory dir exists, false when absent", async () => {
  await withEnv(async ({ root }) => {
    // No .memory directory yet
    const absent = await detectLegacyMemory(root);
    assert.equal(absent.detected, false);
    assert.equal(absent.fileCount, 0);

    // Create the directory with a file
    await seedLegacyMemory(root, { workItems: [{ id: "wi-1", title: "Task" }] });

    const present = await detectLegacyMemory(root);
    assert.equal(present.detected, true);
    assert.ok(present.fileCount > 0, "fileCount must be > 0 when .memory has files");
    assert.ok(present.estimatedRecords >= 1, "estimatedRecords must be >= 1");
    assert.ok(present.path.endsWith(LEGACY_MEMORY_DIR));
  });
});

test("Issue #13 AC1: detectLegacyMemory does NOT import any records", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Detect WS");
    await seedLegacyMemory(root, { workItems: [{ id: "wi-1", title: "Task" }] });

    // Detection only — no side-effects
    await detectLegacyMemory(root);

    const records = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(records.length, 0, "Detection must not import any records");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2: Preflight report — recognized records, warnings, duplicates, quarantine
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC2: preflight returns recognized kinds, count, quarantine, warnings, and expected effects", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Preflight WS");

    await seedLegacyMemory(root, {
      workItems: [
        { id: "wi-1", title: "Good item" },
        null, // malformed
      ],
      incomingSignals: [{ id: "sig-1", message: "Alert" }],
      extraFiles: [{ name: "mystery.json", content: '{"unknown": true}' }],
    });

    const report = await preflight(root, store, "alice", ws.id);

    assert.equal(report.detected, true);
    assert.ok(report.recognizedKinds.includes("workItems"), "workItems must be recognized");
    assert.ok(
      report.recognizedKinds.includes("incomingSignals"),
      "incomingSignals must be recognized"
    );
    assert.ok(report.recognizedCount >= 2, "At least 2 valid records recognized");
    assert.ok(report.quarantinedCount >= 1, "At least 1 malformed record quarantined");
    assert.ok(report.unknownKinds.length >= 1, "Unknown file must be flagged");
    assert.ok(report.warnings.length > 0, "Warnings must be populated");
    assert.ok(report.expectedEffects.length > 0, "Expected effects must be listed");
    assert.ok(
      report.expectedEffects.some((e) => e.includes("NOT be modified")),
      "Expected effects must mention source preservation"
    );
    assert.equal(report.idempotencyMarkerPresent, false);
  });
});

test("Issue #13 AC2: preflight on absent .memory returns detected=false cleanly", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Empty Preflight WS");
    const report = await preflight(root, store, "alice", ws.id);
    assert.equal(report.detected, false);
    assert.equal(report.recognizedCount, 0);
    assert.equal(report.quarantinedCount, 0);
  });
});

test("Issue #13 AC2: preflight quarantines malformed legacy JSON without aborting", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Malformed Preflight WS");

    await seedLegacyMemory(root, {
      extraFiles: [{ name: "work-items.json", content: "{not-json" }],
    });

    const report = await preflight(root, store, "alice", ws.id);
    assert.equal(report.detected, true);
    assert.equal(report.recognizedCount, 0);
    assert.equal(report.quarantinedCount, 1);
    assert.ok(
      report.warnings.some((warning) => warning.includes("work-items.json")),
      "Malformed known files must be reported in warnings"
    );
  });
});

test("Issue #13 AC2: preflight surfaces non-parse legacy read failures", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Unreadable Preflight WS");
    const memDir = await seedLegacyMemory(root);
    await mkdir(join(memDir, "work-items.json"), { recursive: true });

    await assert.rejects(() => preflight(root, store, "alice", ws.id));
  });
});

test("Issue #13 AC2: unknown-file scan surfaces non-missing directory failures", async () => {
  await withEnv(async ({ root, store }) => {
    void store;
    const memoryPath = await seedLegacyMemory(root);
    await rm(memoryPath, { recursive: true, force: true });
    await writeFile(memoryPath, "not-a-directory");

    await assert.rejects(() => listLegacyJsonFiles(memoryPath));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3: Idempotency — second execute returns already_migrated, no duplicates
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC3: executeMigration is idempotent — second call returns already_migrated without duplicating records", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Idempotent WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [{ id: "wi-1", title: "Task", status: "open" }],
    });

    // First run
    const first = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(first.status, "completed");
    assert.equal(first.imported, 1);

    // Second run
    const second = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(second.status, "already_migrated");
    assert.equal(second.imported, 0);

    // Verify no duplicates
    const records = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(records.length, 1, "Only 1 record must exist after two migration calls");
  });
});

test("Issue #13 AC3: setLegacyMigrationMarker only stores one marker per workspace", async () => {
  await withEnv(async ({ store }) => {
    const ws = await store.createWorkspace("alice", "Marker WS");

    await store.setLegacyMigrationMarker("alice", ws.id, "corr-1");
    await store.setLegacyMigrationMarker("alice", ws.id, "corr-2");

    const markers = await store.listRecords("alice", ws.id, "legacyMigrations");
    assert.equal(markers.length, 1, "Only one migration marker should be stored");
    assert.equal((markers[0] as Record<string, unknown>).correlationId, "corr-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC4: Provenance — every imported record has source="migration" and repo mapping
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC4: every imported record has provenance.source=migration and correct repositoryId", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Provenance WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [
        { id: "wi-a", title: "Alpha" },
        { id: "wi-b", title: "Beta" },
      ],
      incomingSignals: [{ id: "sig-a", message: "Signal" }],
    });

    await executeMigration(ws.id, repo.id, store, "alice");

    const workItems = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(workItems.length, 2);
    for (const item of workItems) {
      const prov = (item as Record<string, unknown>).provenance as Record<string, unknown>;
      assert.ok(prov, "provenance must be set");
      assert.equal(prov.source, "migration", "source must be 'migration'");
      assert.ok(prov.correlationId, "correlationId must be in provenance");
    }

    const signals = await store.listRecords("alice", ws.id, "incomingSignals");
    assert.equal(signals.length, 1);
    const sigProv = (signals[0] as Record<string, unknown>).provenance as Record<string, unknown>;
    assert.equal(sigProv.source, "migration");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC5: Quarantine — malformed/unknown records quarantined, valid ones proceed
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC5: malformed and unknown-file records are quarantined; valid records still import", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Quarantine WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [
        { id: "wi-good", title: "Good" }, // valid
        null, // malformed — null is not an object
        "bad-string", // malformed — string is not an object
      ],
      extraFiles: [{ name: "unknown-data.json", content: '{"foo": "bar"}' }],
    });

    const result = await executeMigration(ws.id, repo.id, store, "alice");

    // 1 valid work item must import
    assert.equal(result.imported, 1, "Only valid records should be imported");

    // 2 malformed + 1 unknown file = 3 quarantined
    assert.ok(result.quarantined.length >= 3, "Malformed and unknown records must be quarantined");

    const quarantinedKinds = result.quarantined.map((q) => q.kind);
    assert.ok(
      quarantinedKinds.includes("workItems"),
      "workItems quarantine entry must exist for malformed records"
    );
    assert.ok(
      quarantinedKinds.includes("unknown"),
      "unknown quarantine entry must exist for unrecognized files"
    );

    // Valid record is still in the store
    const records = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(records.length, 1);
    assert.equal((records[0] as Record<string, unknown>).title, "Good");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC6: Partial failure — returns resumable report with correlationId
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC6: successful migration records the marker after import completes", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Partial Failure WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [{ id: "wi-1", title: "Task" }],
    });

    // First call — succeeds and writes marker
    const result = await executeMigration(ws.id, repo.id, store, "alice");
    assert.ok(result.correlationId, "correlationId must be present");
    assert.equal(result.status, "completed");

    // Verify marker is durable after a successful import
    const marker = await store.getLegacyMigrationMarker("alice", ws.id);
    assert.equal(marker, result.correlationId, "Marker must equal the correlationId");

    // Second call returns already_migrated — no double import
    const retry = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(retry.status, "already_migrated");
    assert.equal(retry.imported, 0);
  });
});

test("Issue #13 AC6: failed import leaves the marker unset so a retry can resume", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Retryable Failure WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [{ id: "wi-1", title: "Task" }],
    });

    const originalImportMigration = store.importMigration.bind(store);
    let attempts = 0;
    store.importMigration = (async (...args) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("simulated import failure");
      }
      return originalImportMigration(...args);
    }) as typeof store.importMigration;

    const failed = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(failed.status, "partial");
    assert.equal(failed.imported, 0);
    assert.equal(failed.resumeFrom, failed.correlationId);

    const markerAfterFailure = await store.getLegacyMigrationMarker("alice", ws.id);
    assert.equal(markerAfterFailure, null, "Failed imports must not record the marker");

    const retried = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(retried.status, "completed");
    assert.equal(retried.imported, 1);

    const markerAfterRetry = await store.getLegacyMigrationMarker("alice", ws.id);
    assert.equal(
      markerAfterRetry,
      retried.correlationId,
      "Successful retry must persist the marker"
    );
  });
});

test("Issue #13 AC6: marker persistence failure returns partial after importing", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Marker Failure WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [{ id: "wi-1", title: "Task" }],
    });

    store.setLegacyMigrationMarker = (async (...args) => {
      void args;
      throw new Error("simulated marker failure");
    }) as typeof store.setLegacyMigrationMarker;

    const result = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(result.status, "partial");
    assert.equal(result.imported, 1);
    assert.equal(result.resumeFrom, result.correlationId);
    assert.ok(
      result.warnings.some((warning) => warning.includes("failed to persist the migration marker"))
    );

    const workItems = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(workItems.length, 1);
    assert.equal(await store.getLegacyMigrationMarker("alice", ws.id), null);
  });
});

test("Issue #13 AC6: executeMigration does not write a marker when no legacy state exists", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "No Legacy State WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    const result = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(result.status, "completed");
    assert.equal(result.imported, 0);

    const marker = await store.getLegacyMigrationMarker("alice", ws.id);
    assert.equal(marker, null, "No marker should be recorded when .memory is absent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC7: Source preservation — .memory directory is NEVER modified
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC7: .memory directory is never deleted or modified after migration", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Preservation WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    const memDir = await seedLegacyMemory(root, {
      workItems: [{ id: "wi-1", title: "Preserved" }],
    });

    // Record original state
    const beforeFiles = await readdir(memDir, { recursive: true });
    const beforeStat = await stat(join(memDir, "work-items.json"));
    const beforeMtime = beforeStat.mtimeMs;

    // Execute migration
    await executeMigration(ws.id, repo.id, store, "alice");

    // Verify directory still exists and is unmodified
    const afterFiles = await readdir(memDir, { recursive: true });
    assert.deepEqual(
      [...beforeFiles].sort(),
      [...afterFiles].sort(),
      ".memory directory contents must be identical after migration"
    );

    const afterStat = await stat(join(memDir, "work-items.json"));
    assert.equal(
      afterStat.mtimeMs,
      beforeMtime,
      "work-items.json mtime must not change — file must not be touched"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC8: Full API round-trip — preflight → execute → verify
// ─────────────────────────────────────────────────────────────────────────────

test("Issue #13 AC8: full round-trip — preflight shows expected effects, execute imports, preflight shows marker present", async () => {
  await withEnv(async ({ root, store }) => {
    const ws = await store.createWorkspace("alice", "Roundtrip WS");
    const repo = await store.registerRepository("alice", ws.id, root);

    await seedLegacyMemory(root, {
      workItems: [
        { id: "wi-1", title: "Alpha" },
        { id: "wi-2", title: "Beta" },
      ],
      incomingSignals: [{ id: "sig-1", message: "Warning" }],
    });

    // Step 1: Preflight before migration
    const before = await preflight(root, store, "alice", ws.id);
    assert.equal(before.detected, true);
    assert.ok(before.recognizedCount >= 3, "3 records recognized before migration");
    assert.equal(before.idempotencyMarkerPresent, false);
    assert.ok(
      before.expectedEffects.some((e) => e.includes("imported")),
      "expectedEffects must mention import"
    );

    // Step 2: Execute migration
    const result = await executeMigration(ws.id, repo.id, store, "alice");
    assert.equal(result.status, "completed");
    assert.equal(result.imported, 3);
    assert.equal(result.quarantined.length, 0);

    // Step 3: Preflight after migration shows marker
    const after = await preflight(root, store, "alice", ws.id);
    assert.equal(after.idempotencyMarkerPresent, true);

    // Step 4: Verify records in store
    const workItems = await store.listRecords("alice", ws.id, "workItems");
    assert.equal(workItems.length, 2);

    const signals = await store.listRecords("alice", ws.id, "incomingSignals");
    assert.equal(signals.length, 1);
  });
});

test("Issue #13 AC8: legacy migration GET route requires repositoryId and resolves the selected repository", async (t) => {
  const tenantId = `tenant-legacy-route-${Date.now()}`;
  const userId = `legacy-route-${Date.now()}`;
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-legacy-route-"));
  const repositoryRootA = join(root, "repo-a");
  const repositoryRootB = join(root, "repo-b");
  await mkdir(repositoryRootA, { recursive: true });
  await mkdir(repositoryRootB, { recursive: true });

  const workspaceStore = new HostedWorkspaceStore(root);
  const domainStore = new HostedDomainStore(root, workspaceStore);
  setHostedWorkspaceStoreForTenant(tenantId, workspaceStore);
  setHostedDomainStoreForTenant(tenantId, domainStore);

  t.after(async () => {
    setHostedWorkspaceStoreForTenant(tenantId, null);
    setHostedDomainStoreForTenant(tenantId, null);
    await rm(root, { recursive: true, force: true });
  });

  const headers = new Headers({
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": tenantId,
  });

  const ws = await domainStore.createWorkspace(userId, "Route WS");
  const repoA = await domainStore.registerRepository(userId, ws.id, repositoryRootA);
  const repoB = await domainStore.registerRepository(userId, ws.id, repositoryRootB);

  await seedLegacyMemory(repositoryRootB, {
    workItems: [{ id: "wi-route", title: "Selected repo" }],
  });

  const missingRepository = await getLegacyMigrationRoute(
    new Request(
      `http://localhost/api/hosted/domain/legacy-migration?view=detect&workspaceId=${ws.id}`,
      { headers }
    )
  );
  assert.equal(missingRepository.status, 400);
  assert.equal((await missingRepository.json()).error, "repositoryId is required");

  const detectFirstRepo = await getLegacyMigrationRoute(
    new Request(
      `http://localhost/api/hosted/domain/legacy-migration?view=detect&workspaceId=${ws.id}&repositoryId=${repoA.id}`,
      { headers }
    )
  );
  assert.equal(detectFirstRepo.status, 200);
  assert.equal((await detectFirstRepo.json()).detected, false);

  const preflightSelectedRepo = await getLegacyMigrationRoute(
    new Request(
      `http://localhost/api/hosted/domain/legacy-migration?view=preflight&workspaceId=${ws.id}&repositoryId=${repoB.id}`,
      { headers }
    )
  );
  assert.equal(preflightSelectedRepo.status, 200);
  const report = await preflightSelectedRepo.json();
  assert.equal(report.detected, true);
  assert.equal(report.recognizedCount, 1);
  assert.equal(
    report.legacyMemoryPath.replace(/^\/private/, ""),
    join(repositoryRootB, LEGACY_MEMORY_DIR).replace(/^\/private/, "")
  );
});

test("Issue #13 AC8: legacy migration POST route requires repositoryId and executes against the selected repository", async (t) => {
  const tenantId = `tenant-legacy-post-${Date.now()}`;
  const userId = `legacy-post-${Date.now()}`;
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-legacy-post-"));
  const repositoryRootA = join(root, "repo-a");
  const repositoryRootB = join(root, "repo-b");
  await mkdir(repositoryRootA, { recursive: true });
  await mkdir(repositoryRootB, { recursive: true });

  const workspaceStore = new HostedWorkspaceStore(root);
  const domainStore = new HostedDomainStore(root, workspaceStore);
  setHostedWorkspaceStoreForTenant(tenantId, workspaceStore);
  setHostedDomainStoreForTenant(tenantId, domainStore);

  t.after(async () => {
    setHostedWorkspaceStoreForTenant(tenantId, null);
    setHostedDomainStoreForTenant(tenantId, null);
    await rm(root, { recursive: true, force: true });
  });

  const headers = new Headers({
    "content-type": "application/json",
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": tenantId,
  });

  const ws = await domainStore.createWorkspace(userId, "POST Route WS");
  await domainStore.registerRepository(userId, ws.id, repositoryRootA);
  const repoB = await domainStore.registerRepository(userId, ws.id, repositoryRootB);

  await seedLegacyMemory(repositoryRootB, {
    workItems: [{ id: "wi-post", title: "Execute selected repo" }],
  });

  const missingRepository = await postLegacyMigrationRoute(
    new Request("http://localhost/api/hosted/domain/legacy-migration", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "execute-legacy-migration",
        workspaceId: ws.id,
      }),
    })
  );
  assert.equal(missingRepository.status, 400);
  assert.equal((await missingRepository.json()).error, "repositoryId is required");

  const executed = await postLegacyMigrationRoute(
    new Request("http://localhost/api/hosted/domain/legacy-migration", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "execute-legacy-migration",
        workspaceId: ws.id,
        repositoryId: repoB.id,
      }),
    })
  );
  assert.equal(executed.status, 200);
  const result = await executed.json();
  assert.equal(result.status, "completed");
  assert.equal(result.imported, 1);

  const workItems = await domainStore.listRecords(userId, ws.id, "workItems");
  assert.equal(workItems.length, 1);
  assert.equal((workItems[0] as Record<string, unknown>).repositoryId, repoB.id);
});
