import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { HostedDomainStore } from "../src/server/hosted-domain/hosted-domain-store";

async function withStore<T>(callback: (store: HostedDomainStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-hosted-conflicts-"));
  try {
    return await callback(new HostedDomainStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AC1: Divergence creates explicit Sync Conflicts instead of silently overwriting
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC1: Concurrent local update against a newer hosted version creates a pending SyncConflict instead of overwriting", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC1 Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac1");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Seed an initial work item at version 1
    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac1",
      title: "Original",
      status: "open",
      priority: "normal",
    });
    assert.equal(base.version, 1);

    // Hosted advances it to version 2
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        priority: "high",
      },
      { baseVersion: 1 }
    );

    const hosted = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(hosted.version, 2);
    assert.equal(hosted.priority, "high");

    // Stale local client tries to sync an update based on version 1
    const result = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [
          {
            externalId: "wi-ac1",
            baseVersion: 1,
            priority: "low",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        ],
      },
    });

    // syncRecords must report a conflict (not a clean sync)
    assert.equal(result.conflicts, 1, "syncRecords must report 1 conflict");
    assert.equal(result.synced, 0, "Nothing should have been synced cleanly");

    // Active record must NOT have been overwritten
    const active = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(active.priority, "high", "Hosted value must be authoritative");
    assert.equal(active.version, 2, "Record version must still be 2");

    // A pending SyncConflict must have been created
    const conflicts = await store.listSyncConflicts("alice", ws.id);
    assert.equal(conflicts.length, 1, "Exactly 1 sync conflict must exist");

    const conflict = conflicts[0];
    assert.equal(conflict.status, "pending");
    assert.equal(conflict.targetRecordId, base.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC2: Conflict records preserve both versions, provenance, reason, and entity
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC2: Conflict record preserves both versions, provenance, reason, and affected entity", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC2 Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac2");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac2",
      title: "Task",
      status: "open",
      priority: "normal",
    });

    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        priority: "critical",
      },
      { baseVersion: 1 }
    );

    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [
          {
            externalId: "wi-ac2",
            baseVersion: 1,
            priority: "low",
            updatedAt: "2033-06-01T10:00:00Z", // skewed future clock
          },
        ],
      },
    });

    const conflicts = await store.listSyncConflicts("alice", ws.id);
    assert.equal(conflicts.length, 1);
    const c = conflicts[0];

    // Both versions must be preserved
    assert.ok(c.hostedRecord, "Hosted record must be preserved");
    assert.ok(c.localRecord, "Local record must be preserved");
    assert.equal(c.localRecord.priority, "low", "Local record must capture local priority");
    assert.equal(c.hostedVersion, 2, "Hosted version must be 2");

    // Provenance must be retained
    assert.ok(c.provenance, "Provenance must be set");

    // Reason must be populated
    assert.ok(c.reason, "Reason must be set");
    assert.ok(
      c.reason.includes("concurrent") || c.reason.includes("conflict"),
      `Unexpected reason: ${c.reason}`
    );

    // Target entity identity must be correct
    assert.equal(c.targetRecordId, base.id);
    assert.equal(c.targetKind, "workItems");

    // Creation timestamp must be present
    assert.ok(c.createdAt, "createdAt must be set");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3a: Resolution is idempotent — second resolve on same conflict is rejected
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC3a: Resolving an already-resolved conflict is rejected (idempotent guard)", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC3a Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac3a");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac3a",
      title: "Item",
      status: "open",
    });
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        status: "in_progress",
      },
      { baseVersion: 1 }
    );

    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [{ externalId: "wi-ac3a", baseVersion: 1, status: "done" }],
      },
    });

    const conflicts = await store.listSyncConflicts("alice", ws.id);
    const conflict = conflicts[0];

    // First resolution: must succeed
    const resolved = await store.resolveSyncConflict("alice", ws.id, conflict.id, "use_hosted");
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.resolution?.decision, "use_hosted");

    // Second resolution on the same conflict: must be rejected
    await assert.rejects(
      () => store.resolveSyncConflict("alice", ws.id, conflict.id, "use_local"),
      (err: Error) =>
        err.message.toLowerCase().includes("already resolved") || (err as any).code === "CONFLICT",
      "Resolving an already-resolved conflict must throw"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3b: Stale decisions are rejected (expectedVersion mismatch)
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC3b: Resolution with a stale expectedVersion is rejected", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC3b Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac3b");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac3b",
      title: "Item",
    });
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        title: "Updated",
      },
      { baseVersion: 1 }
    );

    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [{ externalId: "wi-ac3b", baseVersion: 1, title: "Local Version" }],
      },
    });

    const conflicts = await store.listSyncConflicts("alice", ws.id);
    const conflict = conflicts[0];

    // Use an expectedVersion that does NOT match the conflict's current version
    await assert.rejects(
      () =>
        store.resolveSyncConflict("alice", ws.id, conflict.id, "use_local", {
          expectedVersion: 9999,
        }),
      (err: Error) => (err as any).code === "STALE",
      "Stale expectedVersion must be rejected with STALE error"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3c: use_local resolution applies the local record values to the active record
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC3c: use_local resolution applies local values to the active record", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC3c Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac3c");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac3c",
      title: "Original",
      status: "open",
    });
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        status: "in_progress",
      },
      { baseVersion: 1 }
    );

    // Local client syncs a change to the same "status" field — guaranteed conflict
    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [
          { externalId: "wi-ac3c", baseVersion: 1, status: "cancelled", title: "Local Title" },
        ],
      },
    });

    const [conflict] = await store.listSyncConflicts("alice", ws.id);

    // Resolve using local values
    await store.resolveSyncConflict("alice", ws.id, conflict.id, "use_local");

    // The active record must now reflect local values
    const records = await store.listRecords("alice", ws.id, "workItems");
    const item = records.find((r: any) => r.id === conflict.targetRecordId);
    assert.ok(item, "Record must still exist");
    assert.equal((item as any).title, "Local Title", "use_local must apply the local title");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC3d: use_hosted resolution keeps hosted values on the active record
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC3d: use_hosted resolution keeps hosted values on the active record", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC3d Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac3d");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac3d",
      title: "Original",
      status: "open",
    });
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        status: "done",
      },
      { baseVersion: 1 }
    );

    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [{ externalId: "wi-ac3d", baseVersion: 1, status: "cancelled" }],
      },
    });

    const [conflict] = await store.listSyncConflicts("alice", ws.id);

    await store.resolveSyncConflict("alice", ws.id, conflict.id, "use_hosted");

    const records = await store.listRecords("alice", ws.id, "workItems");
    const item = records.find((r: any) => r.id === conflict.targetRecordId);
    assert.ok(item, "Record must still exist");
    assert.equal((item as any).status, "done", "use_hosted must keep the hosted value");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AC4: Merged audit view retains source, actor, original timestamp, ingestion
//      timestamp, correlation ID, and ordering rationale for both local and
//      hosted events, and is sorted chronologically.
// ──────────────────────────────────────────────────────────────────────────────

test("Issue #12 AC4: mergedAudit returns hosted and local events with full attribution, sorted chronologically", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "AC4 Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/ac4");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Create a work item — this emits a native hosted audit event
    const base = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-ac4",
      title: "Audit Item",
    });

    // Trigger a sync conflict so a conflict resolution audit event is emitted
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      base.id,
      {
        title: "Hosted Title",
      },
      { baseVersion: 1 }
    );

    await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [{ externalId: "wi-ac4", baseVersion: 1, title: "Local Title" }],
      },
    });

    const [conflict] = await store.listSyncConflicts("alice", ws.id);
    await store.resolveSyncConflict("alice", ws.id, conflict.id, "use_local");

    // Fetch the merged audit
    const merged = await store.mergedAudit("alice", ws.id);

    assert.ok(merged.length > 0, "Merged audit must have events");

    // Every event must have a source label
    for (const e of merged) {
      assert.ok(
        e.source === "hosted" || e.source === "local",
        `source must be 'hosted' or 'local', got: ${e.source}`
      );
      assert.ok(e.orderingRationale, "orderingRationale must be set");
    }

    // Events must be sorted chronologically (no timestamp regression)
    for (let i = 1; i < merged.length; i++) {
      const prev = merged[i - 1].occurredAt ?? "";
      const curr = merged[i].occurredAt ?? "";
      assert.ok(curr >= prev, `Events out of order at index ${i}: ${prev} > ${curr}`);
    }

    // The resolution audit event must appear with correct attribution
    const resolveEvent = merged.find(
      (e) => e.action?.includes("resolve") || e.action?.includes("conflict")
    );
    assert.ok(resolveEvent, "Resolution audit event must appear in mergedAudit");
    assert.equal(resolveEvent?.source, "hosted");
    assert.equal(resolveEvent?.orderingRationale, "hosted_authoritative");
    assert.ok(resolveEvent?.userId, "userId must be present on resolution event");
  });
});
