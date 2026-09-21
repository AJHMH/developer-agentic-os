import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "@neondatabase/serverless";

import {
  GET as getWorkspace,
  DELETE as deleteWorkspace,
} from "../src/app/api/hosted/workspaces/[id]/route";
import { POST as transferOwnershipRoute } from "../src/app/api/hosted/workspaces/[id]/transfer/route";
import {
  GET as getApprovals,
  POST as createApprovalRoute,
} from "../src/app/api/hosted/workspaces/[id]/approvals/route";
import { POST as revokeApprovalRoute } from "../src/app/api/hosted/workspaces/[id]/approvals/[approvalId]/revoke/route";
import {
  GET as getRecovery,
  POST as restoreWorkspaceRoute,
} from "../src/app/api/hosted/workspaces/[id]/recovery/route";
import {
  GET as getPolicyRoute,
  PATCH as updatePolicyRoute,
} from "../src/app/api/hosted/workspaces/[id]/policy/route";
import { GET as getMembers } from "../src/app/api/hosted/workspaces/[id]/members/route";
import {
  GET as getWorkspaces,
  POST as createWorkspace,
} from "../src/app/api/hosted/workspaces/route";
import { GET as domainGet } from "../src/app/api/hosted/domain/route";
import {
  NeonHostedStateProvider,
  NeonHostedWorkspaceStateProvider,
} from "../src/server/hosted-persistence/neon-hosted-provider";
import {
  HostedDomainStore,
  setHostedDomainStoreForTenant,
} from "../src/server/hosted-domain/hosted-domain-store";
import {
  HostedWorkspaceStore,
  setHostedWorkspaceStoreForTenant,
} from "../src/server/hosted-workspaces/hosted-workspace-store";
import { NeonHostedObjectStore } from "../src/server/hosted-domain/neon-hosted-object-store";

const tenantId = "org_tenant_destructive_test";

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

  for (const m of [
    "005-hosted-canonical-contract.sql",
    "006-hosted-object-storage.sql",
    "007-hosted-workspace-members-and-invitations.sql",
    "008-hosted-workspace-approvals-and-tombstones.sql",
  ]) {
    const sql = await readFile(resolve(process.cwd(), "migrations", m), "utf8");
    await db.exec(sql);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO schema_migrations (version) VALUES
      ('005-hosted-canonical-contract.sql'),
      ('006-hosted-object-storage.sql'),
      ('007-hosted-workspace-members-and-invitations.sql'),
      ('008-hosted-workspace-approvals-and-tombstones.sql')
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

  await db.query<{ id: string }>(
    `INSERT INTO organizations (name, clerk_org_id)
     VALUES ($1, $2)
     ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ["Destructive Test Tenant", tenantId]
  );

  return {
    db,
    pool,
    close: async () => {
      if (!db.closed) await db.close();
    },
  };
}

function makeHeaders(userId: string, extraHeaders?: Record<string, string>): Headers {
  return new Headers({
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": tenantId,
    "x-hosted-display-name": `User ${userId}`,
    "x-api-version": "2026-09-01",
    "content-type": "application/json",
    ...extraHeaders,
  });
}

test("Protect ownership and destructive workspace actions test suite", async (t) => {
  const prevEnv = { ...process.env };
  process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.FEATURE_HOSTED_INTERNAL_OWNER = "true";
  process.env.DEV_AGENTIC_OS_SECRET_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY";

  const { pool, close } = await createTestDatabase();

  const workspaceStateProvider = new NeonHostedWorkspaceStateProvider(tenantId, pool);
  const domainStateProvider = new NeonHostedStateProvider(tenantId, pool);
  const objectStore = new NeonHostedObjectStore(tenantId, pool);
  const workspaceStore = new HostedWorkspaceStore(process.cwd(), workspaceStateProvider);
  const domainStore = new HostedDomainStore(
    process.cwd(),
    workspaceStore,
    domainStateProvider,
    objectStore,
    undefined,
    undefined,
    tenantId
  );

  setHostedWorkspaceStoreForTenant(tenantId, workspaceStore);
  setHostedDomainStoreForTenant(tenantId, domainStore);

  const ownerId = "user_owner";
  const adminId = "user_admin";
  const otherAdminId = "user_admin_2";
  const memberId = "user_member";

  // Bootstrap a workspace with owner, admin, other admin, and regular member
  const createWsReq = new Request("http://localhost/api/hosted/workspaces", {
    method: "POST",
    headers: makeHeaders(ownerId),
    body: JSON.stringify({ name: "Core Production" }),
  });
  const createWsRes = await createWorkspace(createWsReq);
  assert.equal(createWsRes.status, 201);
  const { workspace } = (await createWsRes.json()) as { workspace: { id: string } };
  const workspaceId = workspace.id;

  // Add members
  const rawState = await workspaceStateProvider.read();
  rawState.members ??= {};
  const wsMembers = (rawState.members[workspaceId] ??= []);
  const now = new Date().toISOString();
  wsMembers.push({
    workspaceId,
    userId: adminId,
    role: "admin",
    joinedAt: now,
  });
  wsMembers.push({
    workspaceId,
    userId: otherAdminId,
    role: "admin",
    joinedAt: now,
  });
  wsMembers.push({
    workspaceId,
    userId: memberId,
    role: "member",
    joinedAt: now,
  });
  (rawState.users[adminId] ??= { workspaces: [], activeWorkspaceId: null }).workspaces.push(
    rawState.workspaces![workspaceId]
  );
  (rawState.users[otherAdminId] ??= { workspaces: [], activeWorkspaceId: null }).workspaces.push(
    rawState.workspaces![workspaceId]
  );
  (rawState.users[memberId] ??= { workspaces: [], activeWorkspaceId: null }).workspaces.push(
    rawState.workspaces![workspaceId]
  );
  await workspaceStateProvider.write(rawState);

  t.after(async () => {
    setHostedWorkspaceStoreForTenant(tenantId, null);
    setHostedDomainStoreForTenant(tenantId, null);
    await close();
    process.env = prevEnv;
  });

  await t.test(
    "1. Criterion 1: Ownership transfer is explicit, idempotent, auditable, and leaves exactly one owner",
    async () => {
      // Admin cannot transfer ownership directly without approval
      const deniedAdminReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ targetUserId: adminId }),
        }
      );
      const deniedAdminRes = await transferOwnershipRoute(deniedAdminReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(deniedAdminRes.status, 403);
      const deniedBody = (await deniedAdminRes.json()) as { error: { code: string } };
      assert.equal(deniedBody.error.code, "FORBIDDEN");

      // Owner directly transfers ownership to adminId
      const transferReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({ targetUserId: adminId }),
        }
      );
      const transferRes = await transferOwnershipRoute(transferReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(transferRes.status, 200);
      const transferBody = (await transferRes.json()) as {
        workspace: { ownerId: string };
        previousOwnerId: string;
        newOwnerId: string;
      };
      assert.equal(transferBody.workspace.ownerId, adminId);
      assert.equal(transferBody.previousOwnerId, ownerId);
      assert.equal(transferBody.newOwnerId, adminId);

      // Verify single owner invariant: check members list
      const membersReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/members`,
        {
          method: "GET",
          headers: makeHeaders(adminId),
        }
      );
      const membersRes = await getMembers(membersReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      const { members } = (await membersRes.json()) as {
        members: Array<{ userId: string; role: string }>;
      };

      const owners = members.filter((m) => m.role === "owner");
      assert.equal(owners.length, 1);
      assert.equal(owners[0].userId, adminId);

      const oldOwner = members.find((m) => m.userId === ownerId);
      assert.equal(oldOwner?.role, "admin"); // Demoted to admin

      // Idempotency: transferring to current owner succeeds without mutating state
      const idempotentReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ targetUserId: adminId }),
        }
      );
      const idempotentRes = await transferOwnershipRoute(idempotentReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(idempotentRes.status, 200);
      const idempotentBody = (await idempotentRes.json()) as {
        workspace: { ownerId: string };
        newOwnerId: string;
      };
      assert.equal(idempotentBody.newOwnerId, adminId);

      // Audit check
      const state = await workspaceStateProvider.read();
      const transferEvents = state.audit.filter(
        (e) => e.action === "workspace.ownership_transferred" && e.workspaceId === workspaceId
      );
      assert.ok(transferEvents.length >= 1);

      // Transfer back to ownerId for subsequent tests
      await workspaceStore.transferOwnership(adminId, workspaceId, ownerId);
    }
  );

  await t.test(
    "2. Criterion 2 & 3: Admins cannot perform protected actions without owner approval; Approval binds actor, action, target, version, reason, and correlation ID",
    async () => {
      // Owner creates an approval for adminId to delete workspace
      const createApprovalReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals`,
        {
          method: "POST",
          headers: makeHeaders(ownerId, { "x-correlation-id": "corr-delete-test-123" }),
          body: JSON.stringify({
            actorId: adminId,
            action: "workspace.delete",
            target: workspaceId,
            version: "v1",
            reason: "Decommissioning legacy workspace",
            expiresInSeconds: 3600,
          }),
        }
      );
      const createApprovalRes = await createApprovalRoute(createApprovalReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(createApprovalRes.status, 201);
      const { approval } = (await createApprovalRes.json()) as {
        approval: {
          id: string;
          actorId: string;
          action: string;
          target: string;
          version: string;
          correlationId: string;
          status: string;
        };
      };
      assert.equal(approval.actorId, adminId);
      assert.equal(approval.action, "workspace.delete");
      assert.equal(approval.target, workspaceId);
      assert.equal(approval.version, "v1");
      assert.equal(approval.correlationId, "corr-delete-test-123");
      assert.equal(approval.status, "pending");

      // Test Binding: Actor Mismatch (otherAdminId tries to use adminId's approval)
      const actorMismatchReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}`,
        {
          method: "DELETE",
          headers: makeHeaders(otherAdminId, { "x-approval-id": approval.id }),
          body: JSON.stringify({ version: "v1" }),
        }
      );
      const actorMismatchRes = await deleteWorkspace(actorMismatchReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(actorMismatchRes.status, 403);
      const actorMismatchBody = (await actorMismatchRes.json()) as { error: { message: string } };
      assert.match(actorMismatchBody.error.message, /different actor/i);

      // Test Binding: Action Mismatch (adminId tries to use delete approval for ownership transfer)
      const actionMismatchReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            targetUserId: adminId,
            approvalId: approval.id,
            version: "v1",
          }),
        }
      );
      const actionMismatchRes = await transferOwnershipRoute(actionMismatchReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(actionMismatchRes.status, 403);
      const actionMismatchBody = (await actionMismatchRes.json()) as { error: { message: string } };
      assert.match(actionMismatchBody.error.message, /action mismatch/i);

      // Test Binding: Target Mismatch (adminId tries to transfer ownership with approval for different target)
      const transferApprovalReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals`,
        {
          method: "POST",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({
            actorId: adminId,
            action: "ownership.transfer",
            target: adminId,
            version: "v1",
            reason: "Transfer to adminId",
          }),
        }
      );
      const transferApprovalRes = await createApprovalRoute(transferApprovalReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      const { approval: tApp } = (await transferApprovalRes.json()) as {
        approval: { id: string };
      };

      const targetMismatchReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            targetUserId: otherAdminId, // Different from tApp.target which is adminId
            approvalId: tApp.id,
            version: "v1",
          }),
        }
      );
      const targetMismatchRes = await transferOwnershipRoute(targetMismatchReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(targetMismatchRes.status, 403);
      const targetMismatchBody = (await targetMismatchRes.json()) as { error: { message: string } };
      assert.match(targetMismatchBody.error.message, /target mismatch/i);

      // Test Binding: Version Mismatch (adminId passes stale version)
      const versionMismatchReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            targetUserId: adminId,
            approvalId: tApp.id,
            version: "v2-stale", // Mismatch with "v1"
          }),
        }
      );
      const versionMismatchRes = await transferOwnershipRoute(versionMismatchReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(versionMismatchRes.status, 409); // STALE_STATE
      const versionMismatchBody = (await versionMismatchRes.json()) as {
        error: { code: string };
      };
      assert.equal(versionMismatchBody.error.code, "STALE_STATE");

      // Successful Transfer with valid approval
      const validTransferReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            targetUserId: adminId,
            approvalId: tApp.id,
            version: "v1",
          }),
        }
      );
      const validTransferRes = await transferOwnershipRoute(validTransferReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(validTransferRes.status, 200);

      // Transfer back to ownerId so adminId is an admin again
      await workspaceStore.transferOwnership(adminId, workspaceId, ownerId);

      // Replay Prevention: Attempt to consume tApp.id AGAIN fails closed with CONFLICT
      const replayReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            targetUserId: adminId,
            approvalId: tApp.id,
            version: "v1",
          }),
        }
      );
      const replayRes = await transferOwnershipRoute(replayReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(replayRes.status, 409); // CONFLICT
      const replayBody = (await replayRes.json()) as { error: { message: string } };
      assert.match(replayBody.error.message, /already been consumed and cannot be replayed/i);
    }
  );

  await t.test(
    "3. Criterion 4: Stale, revoked, expired, or cross-workspace approvals fail closed",
    async () => {
      // Revoked Approval
      const createRevokableReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals`,
        {
          method: "POST",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({
            actorId: adminId,
            action: "domain.export_full",
            target: workspaceId,
            version: "v1",
            reason: "Backup export request",
          }),
        }
      );
      const createRevokableRes = await createApprovalRoute(createRevokableReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      const { approval: revokable } = (await createRevokableRes.json()) as {
        approval: { id: string };
      };

      // Owner revokes it
      const revokeReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals/${revokable.id}/revoke`,
        {
          method: "POST",
          headers: makeHeaders(ownerId),
        }
      );
      const revokeRes = await revokeApprovalRoute(revokeReq, {
        params: Promise.resolve({ id: workspaceId, approvalId: revokable.id }),
      });
      assert.equal(revokeRes.status, 200);

      // Verify list approvals includes the revoked approval
      const listReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals`,
        {
          method: "GET",
          headers: makeHeaders(adminId),
        }
      );
      const listRes = await getApprovals(listReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as {
        approvals: Array<{ id: string; status: string }>;
      };
      const listed = listBody.approvals.find((a) => a.id === revokable.id);
      assert.ok(listed);
      assert.equal(listed.status, "revoked");

      // Admin attempts export with revoked approval -> fails with CONFLICT
      const exportReq = new Request(
        `http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=backup&approvalId=${revokable.id}`,
        {
          method: "GET",
          headers: makeHeaders(adminId),
        }
      );
      const exportRes = await domainGet(exportReq);
      assert.equal(exportRes.status, 409);
      const exportBody = (await exportRes.json()) as { error: string };
      assert.match(exportBody.error, /revoked/i);

      // Expired Approval
      const expiredApp = await workspaceStore.createApproval(ownerId, workspaceId, {
        actorId: adminId,
        action: "domain.export_full",
        target: workspaceId,
        version: "v1",
        reason: "Instant expiry test",
        expiresInSeconds: -10, // Already expired
      });

      await assert.rejects(
        async () => {
          await workspaceStore.consumeApproval(adminId, workspaceId, expiredApp.id, {
            action: "domain.export_full",
            target: workspaceId,
            version: "v1",
          });
        },
        { name: "HostedWorkspaceError", message: /expired/i }
      );

      // Verify listApprovals durably reports expired
      const allApprovals = await workspaceStore.listApprovals(adminId, workspaceId);
      const expiredInList = allApprovals.find((a) => a.id === expiredApp.id);
      assert.equal(expiredInList?.status, "expired");

      // Cross-Workspace Approval
      const otherWs = await workspaceStore.create(ownerId, "Secondary Workspace");
      const crossRawState = await workspaceStateProvider.read();
      (crossRawState.members![otherWs.id] ??= []).push({
        workspaceId: otherWs.id,
        userId: adminId,
        role: "admin",
        joinedAt: new Date().toISOString(),
      });
      await workspaceStateProvider.write(crossRawState);

      const crossWsApp = await workspaceStore.createApproval(ownerId, otherWs.id, {
        actorId: adminId,
        action: "domain.export_full",
        target: otherWs.id,
        version: "v1",
        reason: "Secondary ws export",
      });

      // Attempting to consume otherWs approval on workspaceId fails closed (NOT_FOUND)
      await assert.rejects(
        async () => {
          await workspaceStore.consumeApproval(adminId, workspaceId, crossWsApp.id, {
            action: "domain.export_full",
            target: workspaceId,
            version: "v1",
          });
        },
        { name: "HostedWorkspaceError", message: /Approval not found/i }
      );
    }
  );

  await t.test(
    "4. Criterion 5: Destructive workspace deletion exposes documented verification and recovery info to engineer runbooks",
    async () => {
      // Admin without approval cannot delete
      const unapprovedDelReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}`,
        {
          method: "DELETE",
          headers: makeHeaders(adminId),
        }
      );
      const unapprovedDelRes = await deleteWorkspace(unapprovedDelReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(unapprovedDelRes.status, 403);

      // Owner approves deletion for adminId
      const delApproval = await workspaceStore.createApproval(ownerId, workspaceId, {
        actorId: adminId,
        action: "workspace.delete",
        target: workspaceId,
        version: "v1",
        reason: "Quarterly cleanup runbook",
      });

      // Admin executes deletion with approval
      const delReq = new Request(`http://localhost/api/hosted/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers: makeHeaders(adminId, { "x-approval-id": delApproval.id }),
        body: JSON.stringify({ version: "v1" }),
      });
      const delRes = await deleteWorkspace(delReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(delRes.status, 200);
      const delBody = (await delRes.json()) as {
        ok: boolean;
        workspaceId: string;
        status: string;
        recovery: {
          recoveryBackupId: string;
          backupChecksum: string;
          deletedAt: string;
          deletedBy: string;
          retentionWindowDays: number;
          runbook: string;
          restoreSeam: string;
        };
      };
      assert.equal(delBody.status, "tombstoned");
      assert.ok(delBody.recovery.recoveryBackupId);
      assert.ok(delBody.recovery.backupChecksum);
      assert.equal(delBody.recovery.deletedBy, adminId);
      assert.equal(delBody.recovery.retentionWindowDays, 30);
      assert.equal(delBody.recovery.runbook, "docs/runbooks/workspace-recovery.md");

      // Verify fail-closed behavior for standard queries:
      // Standard listing excludes tombstoned workspace
      const listRes = await getWorkspaces(
        new Request("http://localhost/api/hosted/workspaces", {
          headers: makeHeaders(ownerId),
        })
      );
      const { workspaces: wsList } = (await listRes.json()) as {
        workspaces: Array<{ id: string }>;
      };
      assert.ok(!wsList.some((w) => w.id === workspaceId));

      // Standard GET returns 404
      const getWsRes = await getWorkspace(
        new Request(`http://localhost/api/hosted/workspaces/${workspaceId}`, {
          headers: makeHeaders(ownerId),
        }),
        { params: Promise.resolve({ id: workspaceId }) }
      );
      assert.equal(getWsRes.status, 404);

      // Engineer runbook caller inspects recovery metadata
      const recoveryReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/recovery`,
        {
          headers: makeHeaders(adminId),
        }
      );
      const recoveryRes = await getRecovery(recoveryReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(recoveryRes.status, 200);
      const recoveryBody = (await recoveryRes.json()) as {
        recovery: { recoveryBackupId: string; backupChecksum: string };
      };
      assert.equal(recoveryBody.recovery.recoveryBackupId, delBody.recovery.recoveryBackupId);

      // Admin attempts restore without approval -> 403 FORBIDDEN
      const adminNoAppRestoreReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/recovery`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
        }
      );
      const adminNoAppRestoreRes = await restoreWorkspaceRoute(adminNoAppRestoreReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(adminNoAppRestoreRes.status, 403);

      // Replay prevention across actions: admin attempts restore using delete approval
      const delApprovalMismatch = await workspaceStore.createApproval(ownerId, workspaceId, {
        actorId: adminId,
        action: "workspace.delete",
        target: workspaceId,
        version: "v1",
        reason: "Delete approval replay test",
      });
      const mismatchRestoreReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/recovery`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ approvalId: delApprovalMismatch.id, version: "v1" }),
        }
      );
      const mismatchRestoreRes = await restoreWorkspaceRoute(mismatchRestoreReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(mismatchRestoreRes.status, 403);
      const mismatchRestoreBody = (await mismatchRestoreRes.json()) as {
        error: { message: string };
      };
      assert.match(mismatchRestoreBody.error.message, /action mismatch/i);

      // Retention window expiration: tombstone older than retention window fails closed (409 CONFLICT)
      const rawState = await workspaceStateProvider.read();
      const originalDeletedAt = rawState.workspaces![workspaceId].deletedAt!;
      const expiredDeletedAt = new Date(Date.now() - 35 * 86400 * 1000).toISOString();
      rawState.workspaces![workspaceId].deletedAt = expiredDeletedAt;
      if (rawState.workspaces![workspaceId].recoveryInfo) {
        rawState.workspaces![workspaceId].recoveryInfo!.deletedAt = expiredDeletedAt;
      }
      await workspaceStateProvider.write(rawState);

      const expiredRestoreReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/recovery`,
        {
          method: "POST",
          headers: makeHeaders(ownerId),
        }
      );
      const expiredRestoreRes = await restoreWorkspaceRoute(expiredRestoreReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(expiredRestoreRes.status, 409);
      const expiredRestoreBody = (await expiredRestoreRes.json()) as { error: { message: string } };
      assert.match(expiredRestoreBody.error.message, /retention window has expired/i);

      // Restore valid deletedAt
      rawState.workspaces![workspaceId].deletedAt = originalDeletedAt;
      if (rawState.workspaces![workspaceId].recoveryInfo) {
        rawState.workspaces![workspaceId].recoveryInfo!.deletedAt = originalDeletedAt;
      }
      await workspaceStateProvider.write(rawState);

      // Owner grants distinct workspace.restore approval to admin
      const restoreApproval = await workspaceStore.createApproval(ownerId, workspaceId, {
        actorId: adminId,
        action: "workspace.restore",
        target: workspaceId,
        version: "v1",
        reason: "Disaster recovery restoration",
      });

      // Admin restores workspace using valid restore approval
      const restoreReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/recovery`,
        {
          method: "POST",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ approvalId: restoreApproval.id, version: "v1" }),
        }
      );
      const restoreRes = await restoreWorkspaceRoute(restoreReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(restoreRes.status, 200);
      const { workspace: restoredWs } = (await restoreRes.json()) as {
        workspace: { status: string };
      };
      assert.equal(restoredWs.status, "active");

      // Now standard GET succeeds again
      const verifyGetRes = await getWorkspace(
        new Request(`http://localhost/api/hosted/workspaces/${workspaceId}`, {
          headers: makeHeaders(ownerId),
        }),
        { params: Promise.resolve({ id: workspaceId }) }
      );
      assert.equal(verifyGetRes.status, 200);
    }
  );

  await t.test(
    "5. Criterion 2: Admins cannot change audit/approval policy without owner approval; Optimistic Concurrency Control",
    async () => {
      // Get current policy
      const getPolReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          headers: makeHeaders(adminId),
        }
      );
      const getPolRes = await getPolicyRoute(getPolReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(getPolRes.status, 200);
      const { policy: initialPolicy } = (await getPolRes.json()) as {
        policy: { version: number; requireApprovalForDelete: boolean };
      };
      assert.equal(initialPolicy.version, 1);
      assert.equal(initialPolicy.requireApprovalForDelete, true);

      // Missing expectedVersion -> 400 VALIDATION_ERROR
      const missingVerReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ requireApprovalForDelete: false }),
        }
      );
      const missingVerRes = await updatePolicyRoute(missingVerReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(missingVerRes.status, 400);

      // Admin cannot update policy without approval
      const unapprovedPolReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(adminId),
          body: JSON.stringify({ expectedVersion: 1, requireApprovalForDelete: false }),
        }
      );
      const unapprovedPolRes = await updatePolicyRoute(unapprovedPolReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(unapprovedPolRes.status, 403);

      // Owner approves policy change for adminId
      const polApproval = await workspaceStore.createApproval(ownerId, workspaceId, {
        actorId: adminId,
        action: "policy.update",
        target: workspaceId,
        version: "1", // Expects version 1
        reason: "Adjust approval policy for automated tooling",
      });

      // Admin updates policy with approval and expectedVersion 1
      const updatePolReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(adminId),
          body: JSON.stringify({
            approvalId: polApproval.id,
            expectedVersion: 1,
            approvalExpiryWindowSeconds: 7200,
          }),
        }
      );
      const updatePolRes = await updatePolicyRoute(updatePolReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(updatePolRes.status, 200);
      const { policy: updatedPolicy } = (await updatePolRes.json()) as {
        policy: { version: number; approvalExpiryWindowSeconds: number };
      };
      assert.equal(updatedPolicy.version, 2);
      assert.equal(updatedPolicy.approvalExpiryWindowSeconds, 7200);

      // Optimistic concurrency control: owner attempts update with stale expectedVersion 1
      const stalePolReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({
            expectedVersion: 1, // Stale, current is 2
            requireApprovalForExport: false,
          }),
        }
      );
      const stalePolRes = await updatePolicyRoute(stalePolReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(stalePolRes.status, 409); // STALE_STATE

      // Policy switch enforcement: owner sets requireApprovalForExport = false with expectedVersion 2
      const disableExportApprovalReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({
            expectedVersion: 2,
            requireApprovalForExport: false,
          }),
        }
      );
      const disableExportApprovalRes = await updatePolicyRoute(disableExportApprovalReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(disableExportApprovalRes.status, 200);

      // Now admin can export backup WITHOUT approval
      const adminExportNoApprovalReq = new Request(
        `http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=backup`,
        {
          headers: makeHeaders(adminId),
        }
      );
      const adminExportNoApprovalRes = await domainGet(adminExportNoApprovalReq);
      assert.equal(adminExportNoApprovalRes.status, 200);

      // Owner restores requireApprovalForExport = true with expectedVersion 3
      const restoreExportPolicyReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(ownerId),
          body: JSON.stringify({
            expectedVersion: 3,
            requireApprovalForExport: true,
          }),
        }
      );
      const restoreExportPolicyRes = await updatePolicyRoute(restoreExportPolicyReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(restoreExportPolicyRes.status, 200);
    }
  );

  await t.test(
    "6. Criterion 6: Owner/Admin/Member role boundaries and proof of no partial mutation on denied actions",
    async () => {
      // Member attempts to create approval -> FORBIDDEN
      const memberApprovalReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/approvals`,
        {
          method: "POST",
          headers: makeHeaders(memberId),
          body: JSON.stringify({
            actorId: memberId,
            action: "workspace.delete",
            target: workspaceId,
            version: "v1",
            reason: "Unauthorized attempt",
          }),
        }
      );
      const memberApprovalRes = await createApprovalRoute(memberApprovalReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(memberApprovalRes.status, 403);

      // Member attempts to transfer ownership -> FORBIDDEN
      const memberTransferReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/transfer`,
        {
          method: "POST",
          headers: makeHeaders(memberId),
          body: JSON.stringify({ targetUserId: memberId }),
        }
      );
      const memberTransferRes = await transferOwnershipRoute(memberTransferReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(memberTransferRes.status, 403);

      // Member attempts to export backup -> FORBIDDEN
      const memberExportReq = new Request(
        `http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=backup`,
        {
          headers: makeHeaders(memberId),
        }
      );
      const memberExportRes = await domainGet(memberExportReq);
      assert.equal(memberExportRes.status, 403);

      // Member attempts to update policy -> FORBIDDEN
      const memberPolReq = new Request(
        `http://localhost/api/hosted/workspaces/${workspaceId}/policy`,
        {
          method: "PATCH",
          headers: makeHeaders(memberId),
          body: JSON.stringify({ expectedVersion: 2, requireApprovalForDelete: false }),
        }
      );
      const memberPolRes = await updatePolicyRoute(memberPolReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(memberPolRes.status, 403);

      // Verify that after all failed attempts, state is NOT partially mutated
      const finalWs = await workspaceStore.get(ownerId, workspaceId);
      assert.equal(finalWs.ownerId, ownerId);
      assert.equal(finalWs.status, "active");

      const members = await workspaceStore.listMembers(ownerId, workspaceId);
      const memberUser = members.find((m) => m.userId === memberId);
      assert.equal(memberUser?.role, "member");

      const ownerUser = members.find((m) => m.userId === ownerId);
      assert.equal(ownerUser?.role, "owner");
    }
  );
});
