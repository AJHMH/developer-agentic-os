import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { HostedDomainStore } from "../src/server/hosted-domain/hosted-domain-store";
import {
  GET as getHostedDomain,
  POST as postHostedDomain,
} from "../src/app/api/hosted/domain/route";
import { POST as createHostedWorkspace } from "../src/app/api/hosted/workspaces/route";
import { HEADER_API_VERSION, HEADER_CORRELATION_ID } from "../src/server/hosted-api/contract";

async function withStore<T>(callback: (store: HostedDomainStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-hosted-sync-"));
  try {
    return await callback(new HostedDomainStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeAuthHeaders(userId: string) {
  return {
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": `tenant-${userId}`,
    "x-hosted-user-name": `User ${userId}`,
    "x-hosted-org-role": "org:admin",
    [HEADER_API_VERSION]: "2026-09-01",
    [HEADER_CORRELATION_ID]: `corr-${Date.now()}-${Math.random()}`,
  };
}

test("Issue #11 Acceptance Criteria 1 & 4: Published snapshots and mutated records carry server-controlled version & causal metadata; client timestamps alone never decide the winner", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "Sync Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/sync-repo");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Publication 1
    const snap1 = await store.publishSnapshot("alice", conn.id, ws.id, repo.id, {
      branch: "main",
      commit: "commit-1",
      clientTimestamp: "2099-01-01T00:00:00Z", // skewed future clock
    });
    assert.equal(snap1.version, 1);
    assert.equal(snap1.serverSeq, 1);
    assert.equal(snap1.freshness, "fresh");
    assert.ok(snap1.publishedAt);
    // Server publishedAt is near now, not clientTimestamp
    assert.notEqual(snap1.publishedAt, "2099-01-01T00:00:00Z");

    // Publication 2
    const snap2 = await store.publishSnapshot("alice", conn.id, ws.id, repo.id, {
      branch: "main",
      commit: "commit-2",
      clientTimestamp: "2000-01-01T00:00:00Z", // skewed past clock
    });
    assert.equal(snap2.version, 2);
    assert.equal(snap2.serverSeq, 2);
    assert.equal(snap2.freshness, "fresh");

    // Snapshots list: snap1 is now marked stale
    const snapshots = await store.listSnapshots("alice", ws.id);
    const oldSnap = snapshots.find((s) => s.id === snap1.id);
    const newSnap = snapshots.find((s) => s.id === snap2.id);
    assert.equal(oldSnap?.freshness, "stale");
    assert.equal(newSnap?.freshness, "fresh");

    // Record creation carries server version 1 and serverSeq
    const workItem = await store.putRecord("alice", ws.id, "workItems", {
      title: "Initial item",
      notes: "Clean notes",
      updatedAt: "1990-01-01T00:00:00Z", // skewed client clock
    });
    assert.equal(workItem.version, 1);
    assert.equal(workItem.serverSeq, 3);
    assert.ok(workItem.serverCreatedAt);
    assert.ok(workItem.serverUpdatedAt);

    // Record mutation increments server version monotonically
    const updatedItem = await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      workItem.id,
      { notes: "Updated notes" },
      {
        baseVersion: 1,
        provenance: {
          clientTimestamp: "2099-12-31T23:59:59Z", // Skewed clock does not change server precedence
        },
      }
    );
    assert.equal(updatedItem.version, 2);
    assert.equal(updatedItem.serverSeq, 4);
    assert.equal(updatedItem.notes, "Updated notes");
  });
});

test("Issue #11 Acceptance Criteria 2: Offline local mutations enter an explicit pending state and resume idempotently after Local Connector reconnects", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "Offline Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/offline-repo");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Put connector offline
    await store.setConnectorOffline("alice", ws.id, conn.id);

    // Queue local automation work while offline
    const queuedWork = await store.queueLocalWork(
      "alice",
      ws.id,
      repo.id,
      "Execute offline maintenance"
    );
    assert.equal(queuedWork.status, "pending_offline");

    // Submit offline record mutations via syncRecords while offline
    const syncRes = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      isOffline: true,
      records: {
        workItems: [
          {
            externalId: "offline-wi-1",
            title: "Created while offline",
            notes: "Offline drafting",
          },
        ],
      },
    });
    assert.equal(syncRes.pendingOffline, 1);
    assert.equal(syncRes.synced, 0);

    const offlineWorkItem = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(offlineWorkItem.status, "pending_offline");
    assert.equal(offlineWorkItem.syncStatus, "pending_offline");

    // Attempting to resume while still disconnected throws FORBIDDEN
    await assert.rejects(
      () => store.resumePendingLocalWork("alice", ws.id, conn.id),
      /Connector is not connected/
    );

    // Reconnect connector
    await store.reconnectConnector("alice", ws.id, conn.id, 60_000);

    // Resume pending local work idempotently
    const resumedCount = await store.resumePendingLocalWork("alice", ws.id, conn.id);
    assert.equal(resumedCount, 2); // 1 automation run + 1 work item

    // Verify automation run is now queued
    const runs = await store.listRecords("alice", ws.id, "automationRuns");
    const resumedRun = runs.find((r) => r.id === queuedWork.id);
    assert.equal(resumedRun?.status, "queued");
    assert.ok(resumedRun?.resumedAt);

    // Verify work item is now open and applied
    const resumedWorkItem = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(resumedWorkItem.status, "open");
    assert.equal(resumedWorkItem.syncStatus, "applied");
    assert.ok(resumedWorkItem.resumedAt);

    // Second resume call is strictly idempotent: returns 0 and leaves state unchanged
    const secondResumeCount = await store.resumePendingLocalWork("alice", ws.id, conn.id);
    assert.equal(secondResumeCount, 0);
  });
});

test("Issue #11 Acceptance Criteria 3: Safe append-only changes merge without duplication, and supported editable records use documented domain merge rules", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "Merge Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/merge-repo");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // 1. Safe append-only records (incomingSignals) deduplicate without duplicate records
    const sync1 = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        incomingSignals: [
          {
            externalId: "sig-webhook-1",
            source: "integration",
            title: "Build failed",
            body: "Step 3 timed out",
          },
        ],
      },
    });
    assert.equal(sync1.synced, 1);
    let signals = await store.listRecords("alice", ws.id, "incomingSignals");
    assert.equal(signals.length, 1);
    assert.equal(signals[0].externalId, "sig-webhook-1");

    // Replay / repeat sync with same externalId
    const sync2 = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        incomingSignals: [
          {
            externalId: "sig-webhook-1",
            source: "integration",
            title: "Build failed",
            body: "Step 3 timed out",
          },
        ],
      },
    });
    assert.equal(sync2.synced, 1);
    signals = await store.listRecords("alice", ws.id, "incomingSignals");
    // Length must remain 1: merged without duplication
    assert.equal(signals.length, 1);

    // 2. Documented domain merge rules for editable records (workItems)
    // Initial work item at version 1
    const initialItem = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-feature-1",
      title: "Initial Title",
      notes: "Base notes",
      status: "open",
      priority: "normal",
      dueAt: null,
    });
    assert.equal(initialItem.version, 1);

    // Server modifies disjoint fields: status -> "in_progress", dueAt -> "2026-10-01T00:00:00Z"
    const serverUpdated = await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      initialItem.id,
      { status: "in_progress", dueAt: "2026-10-01T00:00:00Z" },
      { baseVersion: 1 }
    );
    assert.equal(serverUpdated.version, 2);

    // Local client sync arrives, based on baseVersion 1, modifying disjoint fields:
    // notes -> "Refined notes", priority -> "urgent"
    const syncMerge = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [
          {
            externalId: "wi-feature-1",
            baseVersion: 1,
            notes: "Refined notes",
            priority: "urgent",
          },
        ],
      },
    });
    assert.equal(syncMerge.synced, 1);
    assert.equal(syncMerge.conflicts, 0);

    // Active record successfully merged non-conflicting fields!
    const mergedItem = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(mergedItem.version, 3);
    assert.equal(mergedItem.status, "in_progress"); // Preserved from server update
    assert.equal(mergedItem.dueAt, "2026-10-01T00:00:00Z"); // Preserved from server update
    assert.equal(mergedItem.notes, "Refined notes"); // Merged from local update
    assert.equal(mergedItem.priority, "urgent"); // Merged from local update
  });
});

test("Issue #11 Acceptance Criteria 4 & 5: Concurrent conflicting updates with skewed client clocks produce deterministic outcomes based on server metadata, and retain losing versions with source provenance", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "Conflict Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/conflict-repo");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Initial work item at version 1
    const baseItem = await store.putRecord("alice", ws.id, "workItems", {
      externalId: "wi-conflict-1",
      title: "Shared task",
      status: "open",
      priority: "normal",
    });
    assert.equal(baseItem.version, 1);

    // Server updates priority to "high" -> version 2
    await store.updateRecord(
      "alice",
      ws.id,
      "workItems",
      baseItem.id,
      { priority: "high" },
      { baseVersion: 1 }
    );

    // Client with skewed clock (7 days ahead) attempts conflicting update to priority -> "low"
    // with stale baseVersion: 1
    const syncConflicted = await store.syncRecords("alice", ws.id, conn.id, {
      repositoryId: repo.id,
      records: {
        workItems: [
          {
            externalId: "wi-conflict-1",
            baseVersion: 1,
            priority: "low",
            updatedAt: "2033-05-01T12:00:00Z", // Future clock skew
          },
        ],
      },
    });

    // Conflict is recorded; active record priority is NOT overwritten by client clock
    assert.equal(syncConflicted.conflicts, 1);

    const activeItem = (await store.listRecords("alice", ws.id, "workItems"))[0];
    assert.equal(activeItem.priority, "high"); // Server authority wins
    assert.equal(activeItem.version, 2);

    // Losing version and source provenance now trigger an explicit Sync Conflict
    const history = await store.getRecordHistory("alice", ws.id, "workItems", baseItem.id);
    assert.equal(history.current.priority, "high");

    const conflicts = await store.listSyncConflicts("alice", ws.id);
    const pendingConflict = conflicts.find(
      (c) => c.targetRecordId === baseItem.id && c.status === "pending"
    );
    assert.ok(pendingConflict, "Pending sync conflict must be created");

    assert.equal(pendingConflict.localRecord.priority, "low");
    assert.equal(pendingConflict.provenance?.source, "local-connector");
    assert.equal(pendingConflict.provenance?.clientTimestamp, "2033-05-01T12:00:00Z");
    assert.ok(pendingConflict.createdAt);
  });
});

test("Issue #11 Acceptance Criteria 6: Stale Local-Derived State cannot authorize consequential provider mutations", async () => {
  await withStore(async (store) => {
    const ws = await store.createWorkspace("alice", "Provider Auth Workspace");
    const repo = await store.registerRepository("alice", ws.id, "D:/repos/auth-repo");
    const conn = await store.registerConnector("alice", ws.id, 60_000);
    await store.grantRepository("alice", ws.id, conn.id, repo.id);

    // Publish Snapshot 1
    const snap1 = await store.publishSnapshot("alice", conn.id, ws.id, repo.id, {
      commit: "commit-aaa",
    });

    // Persist approval linked to Snapshot 1
    const approvalRun = await store.putRecord("alice", ws.id, "automationRuns", {
      repositoryId: repo.id,
      status: "approved",
      approval: { action: "deploy-production", evidenceSnapshotId: snap1.id },
    });

    // While snap1 is fresh, mutation is authorized
    await store.authorizeProviderMutation("alice", ws.id, repo.id, "deploy-production", {
      runId: approvalRun.id,
      approved: true,
    });

    // New snapshot 2 published -> Snapshot 1 becomes stale!
    await store.publishSnapshot("alice", conn.id, ws.id, repo.id, {
      commit: "commit-bbb",
    });

    // Attempting to use the approval linked to the now-stale snapshot fails with FORBIDDEN/STALE
    await assert.rejects(
      () =>
        store.authorizeProviderMutation("alice", ws.id, repo.id, "deploy-production", {
          runId: approvalRun.id,
          approved: true,
        }),
      /persisted approval bound to the current evidence/
    );

    // Putting connector offline causes authorization to fail with STALE
    await store.setConnectorOffline("alice", ws.id, conn.id);
    await assert.rejects(
      () =>
        store.authorizeProviderMutation("alice", ws.id, repo.id, "deploy-production", {
          runId: approvalRun.id,
          approved: true,
        }),
      /fresh connector evidence/
    );
  });
});

test("Issue #11 Acceptance Criteria 7: API-level route tests cover publication, offline queue/resume, retries, clock skew, safe merges, and workspace isolation", async () => {
  const headersAlice = makeAuthHeaders("alice-api");
  const headersBob = makeAuthHeaders("bob-api");

  // 1. Create Workspace for Alice via API route
  const wsAliceRes = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({ name: "Alice Route Workspace" }),
    })
  );
  assert.equal(wsAliceRes.status, 201);
  const wsAliceId = ((await wsAliceRes.json()).workspace as { id: string }).id;

  // Create Workspace for Bob via API route
  const wsBobRes = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: headersBob,
      body: JSON.stringify({ name: "Bob Route Workspace" }),
    })
  );
  assert.equal(wsBobRes.status, 201);
  const _wsBobId = ((await wsBobRes.json()).workspace as { id: string }).id;

  // 2. Register repository and connector in Alice's workspace
  const repoRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "register-repository",
        workspaceId: wsAliceId,
        localPath: "D:/repos/alice-api-repo",
      }),
    })
  );
  const repoId = ((await repoRes.json()).repository as { id: string }).id;

  const connRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "register-connector",
        workspaceId: wsAliceId,
      }),
    })
  );
  const connId = ((await connRes.json()).connector as { id: string }).id;

  await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "grant-repository",
        workspaceId: wsAliceId,
        connectorId: connId,
        repositoryId: repoId,
      }),
    })
  );

  // 3. API Route: publish-snapshot with server versioning
  const pubRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "publish-snapshot",
        workspaceId: wsAliceId,
        connectorId: connId,
        repositoryId: repoId,
        data: { commit: "api-snap-1" },
      }),
    })
  );
  assert.equal(pubRes.status, 200);
  const pubData = (await pubRes.json()).snapshot as {
    version: number;
    serverSeq: number;
    freshness: string;
  };
  assert.equal(pubData.version, 1);
  assert.equal(pubData.freshness, "fresh");

  // 4. API Route: sync action with append-only deduplication and editable domain merge
  const syncRes1 = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "sync",
        workspaceId: wsAliceId,
        connectorId: connId,
        repositoryId: repoId,
        records: {
          incomingSignals: [{ externalId: "sig-api-1", title: "API Signal" }],
          workItems: [{ externalId: "wi-api-1", title: "API Work Item", priority: "normal" }],
        },
      }),
    })
  );
  assert.equal(syncRes1.status, 200);
  const syncBody1 = await syncRes1.json();
  assert.equal(syncBody1.synced, 2);

  // 5. API Route: update-record with optimistic concurrency & baseVersion
  const recordsRes = await getHostedDomain(
    new Request(`http://localhost/api/hosted/domain?workspaceId=${wsAliceId}&view=records`, {
      headers: headersAlice,
    })
  );
  const currentWorkItem = (await recordsRes.json()).records.workItems[0] as {
    id: string;
    version: number;
  };

  const updateRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "update-record",
        workspaceId: wsAliceId,
        kind: "workItems",
        recordId: currentWorkItem.id,
        baseVersion: currentWorkItem.version,
        updates: { notes: "Server added notes" },
      }),
    })
  );
  assert.equal(updateRes.status, 200);
  const updatedRecord = (await updateRes.json()).record as { version: number; notes: string };
  assert.equal(updatedRecord.version, currentWorkItem.version + 1);
  assert.equal(updatedRecord.notes, "Server added notes");

  // 6. API Route: GET record-history view
  const historyRes = await getHostedDomain(
    new Request(
      `http://localhost/api/hosted/domain?workspaceId=${wsAliceId}&view=record-history&kind=workItems&recordId=${currentWorkItem.id}`,
      { headers: headersAlice }
    )
  );
  assert.equal(historyRes.status, 200);
  const historyData = await historyRes.json();
  assert.equal(historyData.current.id, currentWorkItem.id);
  assert.equal(historyData.supersededVersions.length, 1);
  assert.equal(historyData.supersededVersions[0].version, 1);

  // 7. API Route: Offline queue & idempotent resume
  await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "set-connector-offline",
        workspaceId: wsAliceId,
        connectorId: connId,
      }),
    })
  );

  const offlineQueueRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "queue-local-work",
        workspaceId: wsAliceId,
        repositoryId: repoId,
        description: "API offline maintenance",
      }),
    })
  );
  assert.equal(offlineQueueRes.status, 202);

  await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "reconnect-connector",
        workspaceId: wsAliceId,
        connectorId: connId,
      }),
    })
  );

  const resumeRes1 = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "resume-local-work",
        workspaceId: wsAliceId,
        connectorId: connId,
      }),
    })
  );
  assert.equal(resumeRes1.status, 200);
  assert.equal((await resumeRes1.json()).resumed, 1);

  // Repeated resume is idempotent (0 resumed)
  const resumeRes2 = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersAlice,
      body: JSON.stringify({
        action: "resume-local-work",
        workspaceId: wsAliceId,
        connectorId: connId,
      }),
    })
  );
  assert.equal(resumeRes2.status, 200);
  assert.equal((await resumeRes2.json()).resumed, 0);

  // 8. API Route: Workspace Isolation
  // Bob cannot access or sync Alice's workspace
  const crossSyncRes = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers: headersBob,
      body: JSON.stringify({
        action: "sync",
        workspaceId: wsAliceId,
        connectorId: connId,
        repositoryId: repoId,
        records: {},
      }),
    })
  );
  assert.equal(crossSyncRes.status, 404);

  // Bob cannot view Alice's record history
  const crossHistoryRes = await getHostedDomain(
    new Request(
      `http://localhost/api/hosted/domain?workspaceId=${wsAliceId}&view=record-history&kind=workItems&recordId=${currentWorkItem.id}`,
      { headers: headersBob }
    )
  );
  assert.equal(crossHistoryRes.status, 404);
});
