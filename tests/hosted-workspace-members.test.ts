import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "@neondatabase/serverless";

import {
  GET as getInvitations,
  POST as createInvitation,
} from "../src/app/api/hosted/workspaces/[id]/invitations/route";
import { POST as acceptInvitation } from "../src/app/api/hosted/invitations/[id]/accept/route";
import { POST as revokeInvitation } from "../src/app/api/hosted/invitations/[id]/revoke/route";
import {
  GET as getMembers,
  PATCH as updateMemberRole,
  DELETE as removeMember,
} from "../src/app/api/hosted/workspaces/[id]/members/route";
import {
  GET as getWorkspaces,
  POST as createWorkspace,
} from "../src/app/api/hosted/workspaces/route";
import { POST as selectWorkspace } from "../src/app/api/hosted/workspaces/[id]/select/route";
import { GET as domainGet, POST as domainPost } from "../src/app/api/hosted/domain/route";
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

const tenantId = "org_tenant_members_test";

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

  const m7 = await readFile(
    resolve(process.cwd(), "migrations/007-hosted-workspace-members-and-invitations.sql"),
    "utf8"
  );
  await db.exec(m7);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO schema_migrations (version) VALUES
      ('005-hosted-canonical-contract.sql'),
      ('006-hosted-object-storage.sql'),
      ('007-hosted-workspace-members-and-invitations.sql')
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
    ["Members Test Tenant", tenantId]
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
  const h = new Headers({
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": tenantId,
    "x-hosted-display-name": `User ${userId}`,
    "content-type": "application/json",
    ...extraHeaders,
  });
  return h;
}

test("Workspace invitations lifecycle, roles, and authorization test suite", async (t) => {
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

  t.after(async () => {
    setHostedWorkspaceStoreForTenant(tenantId, null);
    setHostedDomainStoreForTenant(tenantId, null);
    process.env = prevEnv;
    await close();
  });

  const ownerUserId = "user_owner_1";
  const adminUserId = "user_admin_2";
  const memberUserId = "user_member_3";
  const outsiderUserId = "user_outsider_4";

  let workspaceId = "";

  await t.test("1. Workspace creation registers exactly one owner member", async () => {
    const createReq = new Request("http://localhost:3000/api/hosted/workspaces", {
      method: "POST",
      headers: makeHeaders(ownerUserId),
      body: JSON.stringify({ name: "Team Engineering" }),
    });
    const createRes = await createWorkspace(createReq);
    assert.equal(createRes.status, 201);
    const createBody = (await createRes.json()) as { workspace: { id: string; ownerId: string } };
    workspaceId = createBody.workspace.id;
    assert.equal(createBody.workspace.ownerId, ownerUserId);

    // Verify members list shows owner
    const membersReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/members`,
      {
        method: "GET",
        headers: makeHeaders(ownerUserId),
      }
    );
    const membersRes = await getMembers(membersReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(membersRes.status, 200);
    const membersBody = (await membersRes.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    assert.equal(membersBody.members.length, 1);
    assert.equal(membersBody.members[0].userId, ownerUserId);
    assert.equal(membersBody.members[0].role, "owner");
  });

  await t.test("2. Invitations cannot assign owner role (Single Owner rule)", async () => {
    const invReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(ownerUserId),
        body: JSON.stringify({
          recipientEmail: "hacker@example.com",
          role: "owner",
        }),
      }
    );
    const invRes = await createInvitation(invReq, { params: Promise.resolve({ id: workspaceId }) });
    assert.equal(invRes.status, 400); // Validation error
  });

  let adminInvitationId = "";

  await t.test("3. Owner invites user as admin and user accepts invitation", async () => {
    const invReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(ownerUserId),
        body: JSON.stringify({
          recipientEmail: "admin@example.com",
          role: "admin",
        }),
      }
    );
    const invRes = await createInvitation(invReq, { params: Promise.resolve({ id: workspaceId }) });
    assert.equal(invRes.status, 201);
    const invBody = (await invRes.json()) as {
      invitation: { id: string; status: string; role: string };
    };
    adminInvitationId = invBody.invitation.id;
    assert.equal(invBody.invitation.status, "pending");
    assert.equal(invBody.invitation.role, "admin");

    // List invitations verifies pending invitation
    const listInvReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "GET",
        headers: makeHeaders(ownerUserId),
      }
    );
    const listInvRes = await getInvitations(listInvReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(listInvRes.status, 200);
    const listInvBody = (await listInvRes.json()) as { invitations: Array<{ id: string }> };
    assert.ok(listInvBody.invitations.some((i) => i.id === adminInvitationId));

    // Acceptance by admin user
    const acceptReq = new Request(
      `http://localhost:3000/api/hosted/invitations/${adminInvitationId}/accept`,
      {
        method: "POST",
        headers: makeHeaders(adminUserId),
        body: JSON.stringify({ recipientEmail: "admin@example.com" }),
      }
    );
    const acceptRes = await acceptInvitation(acceptReq, {
      params: Promise.resolve({ id: adminInvitationId }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptBody = (await acceptRes.json()) as { member: { role: string; userId: string } };
    assert.equal(acceptBody.member.userId, adminUserId);
    assert.equal(acceptBody.member.role, "admin");

    // Idempotent re-acceptance by same user succeeds
    const reacceptRes = await acceptInvitation(acceptReq, {
      params: Promise.resolve({ id: adminInvitationId }),
    });
    assert.equal(reacceptRes.status, 200);
  });

  let memberInvitationId = "";

  await t.test("4. Admin invites user as member and member accepts", async () => {
    // Admin creates invitation for member
    const invReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(adminUserId),
        body: JSON.stringify({
          recipientEmail: "member@example.com",
          role: "member",
        }),
      }
    );
    const invRes = await createInvitation(invReq, { params: Promise.resolve({ id: workspaceId }) });
    assert.equal(invRes.status, 201);
    const invBody = (await invRes.json()) as { invitation: { id: string; role: string } };
    memberInvitationId = invBody.invitation.id;
    assert.equal(invBody.invitation.role, "member");

    // Member accepts
    const acceptReq = new Request(
      `http://localhost:3000/api/hosted/invitations/${memberInvitationId}/accept`,
      {
        method: "POST",
        headers: makeHeaders(memberUserId),
        body: JSON.stringify({ recipientEmail: "member@example.com" }),
      }
    );
    const acceptRes = await acceptInvitation(acceptReq, {
      params: Promise.resolve({ id: memberInvitationId }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptBody = (await acceptRes.json()) as { member: { role: string; userId: string } };
    assert.equal(acceptBody.member.role, "member");
  });

  await t.test("5. Expired invitations cannot be accepted", async () => {
    // Create an invitation with 1 second expiry
    const invReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(adminUserId),
        body: JSON.stringify({
          recipientEmail: "expired@example.com",
          role: "member",
          expiresInSeconds: 1, // Expires in 1s
        }),
      }
    );
    const invRes = await createInvitation(invReq, { params: Promise.resolve({ id: workspaceId }) });
    assert.equal(invRes.status, 201);
    const invId = ((await invRes.json()) as { invitation: { id: string } }).invitation.id;

    // Delay to ensure expiry timestamp is passed
    await new Promise((r) => setTimeout(r, 1100));

    const acceptReq = new Request(`http://localhost:3000/api/hosted/invitations/${invId}/accept`, {
      method: "POST",
      headers: makeHeaders("user_expired_test"),
    });
    const acceptRes = await acceptInvitation(acceptReq, { params: Promise.resolve({ id: invId }) });
    assert.equal(acceptRes.status, 410); // EXPIRED
  });

  await t.test("6. Revoked invitations cannot be accepted", async () => {
    // Create invitation
    const invReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(adminUserId),
        body: JSON.stringify({
          recipientEmail: "revoked@example.com",
          role: "member",
        }),
      }
    );
    const invRes = await createInvitation(invReq, { params: Promise.resolve({ id: workspaceId }) });
    const invId = ((await invRes.json()) as { invitation: { id: string } }).invitation.id;

    // Revoke invitation
    const revokeReq = new Request(`http://localhost:3000/api/hosted/invitations/${invId}/revoke`, {
      method: "POST",
      headers: makeHeaders(adminUserId),
    });
    const revokeRes = await revokeInvitation(revokeReq, { params: Promise.resolve({ id: invId }) });
    assert.equal(revokeRes.status, 200);

    // Attempt accept
    const acceptReq = new Request(`http://localhost:3000/api/hosted/invitations/${invId}/accept`, {
      method: "POST",
      headers: makeHeaders("user_revoked_test"),
    });
    const acceptRes = await acceptInvitation(acceptReq, { params: Promise.resolve({ id: invId }) });
    assert.equal(acceptRes.status, 409); // CONFLICT
  });

  await t.test("7. Role Boundaries - Member capabilities and restrictions", async () => {
    // Member CAN create work item (workflow operation)
    const workItemReq = new Request("http://localhost:3000/api/hosted/domain", {
      method: "POST",
      headers: makeHeaders(memberUserId),
      body: JSON.stringify({
        action: "create-work-item",
        workspaceId,
        title: "Investigate performance bottleneck",
        priority: "high",
      }),
    });
    const workItemRes = await domainPost(workItemReq);
    assert.equal(workItemRes.status, 201);

    // Member CANNOT register connector (connector administration) -> 403
    const connReq = new Request("http://localhost:3000/api/hosted/domain", {
      method: "POST",
      headers: makeHeaders(memberUserId),
      body: JSON.stringify({
        action: "register-connector",
        workspaceId,
      }),
    });
    const connRes = await domainPost(connReq);
    assert.equal(connRes.status, 403);

    // Member CANNOT save credential -> 403
    const credReq = new Request("http://localhost:3000/api/hosted/domain", {
      method: "POST",
      headers: makeHeaders(memberUserId),
      body: JSON.stringify({
        action: "save-credential",
        workspaceId,
        provider: "github",
        scopes: ["repo"],
        secret: "ghp_secret_token",
      }),
    });
    const credRes = await domainPost(credReq);
    assert.equal(credRes.status, 403);

    // Member CANNOT invite other users -> 403
    const inviteReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(memberUserId),
        body: JSON.stringify({
          recipientEmail: "friend@example.com",
          role: "member",
        }),
      }
    );
    const inviteRes = await createInvitation(inviteReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(inviteRes.status, 403);

    // Member CANNOT export backup -> 403
    const backupReq = new Request(
      `http://localhost:3000/api/hosted/domain?workspaceId=${workspaceId}&view=backup`,
      {
        method: "GET",
        headers: makeHeaders(memberUserId),
      }
    );
    const backupRes = await domainGet(backupReq);
    assert.equal(backupRes.status, 403);
  });

  await t.test("8. Role Boundaries - Admin capabilities and restrictions", async () => {
    // Admin CAN register connector
    const connReq = new Request("http://localhost:3000/api/hosted/domain", {
      method: "POST",
      headers: makeHeaders(adminUserId),
      body: JSON.stringify({
        action: "register-connector",
        workspaceId,
      }),
    });
    const connRes = await domainPost(connReq);
    assert.equal(connRes.status, 201);

    // Admin CAN save credential
    const credReq = new Request("http://localhost:3000/api/hosted/domain", {
      method: "POST",
      headers: makeHeaders(adminUserId),
      body: JSON.stringify({
        action: "save-credential",
        workspaceId,
        provider: "github",
        scopes: ["repo"],
        secret: "ghp_admin_secret_token",
      }),
    });
    const credRes = await domainPost(credReq);
    assert.equal(credRes.status, 201);

    // Admin CANNOT export backup (Owner only) -> 403
    const backupReq = new Request(
      `http://localhost:3000/api/hosted/domain?workspaceId=${workspaceId}&view=backup`,
      {
        method: "GET",
        headers: makeHeaders(adminUserId),
      }
    );
    const backupRes = await domainGet(backupReq);
    assert.equal(backupRes.status, 403);

    // Admin CANNOT alter owner's role -> 403
    const alterOwnerReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/members`,
      {
        method: "PATCH",
        headers: makeHeaders(adminUserId),
        body: JSON.stringify({
          userId: ownerUserId,
          role: "admin",
        }),
      }
    );
    const alterOwnerRes = await updateMemberRole(alterOwnerReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(alterOwnerRes.status, 403);
  });

  await t.test("9. Role Boundaries - Owner capabilities", async () => {
    // Owner CAN export backup
    const backupReq = new Request(
      `http://localhost:3000/api/hosted/domain?workspaceId=${workspaceId}&view=backup`,
      {
        method: "GET",
        headers: makeHeaders(ownerUserId),
      }
    );
    const backupRes = await domainGet(backupReq);
    assert.equal(backupRes.status, 200);
    const backupBody = (await backupRes.json()) as { backup: { workspaceId: string } };
    assert.equal(backupBody.backup.workspaceId, workspaceId);

    // Owner CAN update member role to admin
    const updateRoleReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/members`,
      {
        method: "PATCH",
        headers: makeHeaders(ownerUserId),
        body: JSON.stringify({
          userId: memberUserId,
          role: "admin",
        }),
      }
    );
    const updateRoleRes = await updateMemberRole(updateRoleReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(updateRoleRes.status, 200);
    const roleBody = (await updateRoleRes.json()) as { member: { role: string } };
    assert.equal(roleBody.member.role, "admin");

    // Cannot remove workspace owner
    const removeOwnerReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/members?userId=${ownerUserId}`,
      {
        method: "DELETE",
        headers: makeHeaders(adminUserId),
      }
    );
    const removeOwnerRes = await removeMember(removeOwnerReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(removeOwnerRes.status, 403);
  });

  await t.test(
    "10. Two-Workspace Isolation & Anti-Enumeration (404 on non-membership)",
    async () => {
      // Outsider user has their own separate workspace
      const outsiderCreateReq = new Request("http://localhost:3000/api/hosted/workspaces", {
        method: "POST",
        headers: makeHeaders(outsiderUserId),
        body: JSON.stringify({ name: "Outsider Workspace" }),
      });
      const outsiderCreateRes = await createWorkspace(outsiderCreateReq);
      assert.equal(outsiderCreateRes.status, 201);
      const outsiderWsId = ((await outsiderCreateRes.json()) as { workspace: { id: string } })
        .workspace.id;

      // Outsider cannot see Workspace 1 in workspace list
      const listReq = new Request("http://localhost:3000/api/hosted/workspaces", {
        method: "GET",
        headers: makeHeaders(outsiderUserId),
      });
      const listRes = await getWorkspaces(listReq);
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as { workspaces: Array<{ id: string }> };
      assert.ok(!listBody.workspaces.some((ws) => ws.id === workspaceId));
      assert.ok(listBody.workspaces.some((ws) => ws.id === outsiderWsId));

      // Outsider attempting to read Workspace 1 returns 404 NOT_FOUND (not 403)
      const readReq = new Request(
        `http://localhost:3000/api/hosted/domain?workspaceId=${workspaceId}&view=records`,
        {
          method: "GET",
          headers: makeHeaders(outsiderUserId),
        }
      );
      const readRes = await domainGet(readReq);
      assert.equal(readRes.status, 404);

      // Outsider attempting to mutate Workspace 1 returns 404 NOT_FOUND
      const mutateReq = new Request("http://localhost:3000/api/hosted/domain", {
        method: "POST",
        headers: makeHeaders(outsiderUserId),
        body: JSON.stringify({
          action: "create-work-item",
          workspaceId,
          title: "Malicious work item",
        }),
      });
      const mutateRes = await domainPost(mutateReq);
      assert.equal(mutateRes.status, 404);

      // Outsider attempting to select Workspace 1 returns 404 NOT_FOUND
      const selectReq = new Request(
        `http://localhost:3000/api/hosted/workspaces/${workspaceId}/select`,
        {
          method: "POST",
          headers: makeHeaders(outsiderUserId),
        }
      );
      const selectRes = await selectWorkspace(selectReq, {
        params: Promise.resolve({ id: workspaceId }),
      });
      assert.equal(selectRes.status, 404);
    }
  );

  await t.test("11. Correlated, attributable audit log evidence", async () => {
    const testCorrelationId = "corr_invitations_test_12345";
    const auditInvReq = new Request(
      `http://localhost:3000/api/hosted/workspaces/${workspaceId}/invitations`,
      {
        method: "POST",
        headers: makeHeaders(ownerUserId, {
          "x-correlation-id": testCorrelationId,
          "x-api-version": "2026-09-01",
        }),
        body: JSON.stringify({
          recipientEmail: "audit@example.com",
          role: "member",
        }),
      }
    );
    const auditInvRes = await createInvitation(auditInvReq, {
      params: Promise.resolve({ id: workspaceId }),
    });
    assert.equal(auditInvRes.status, 201);
    assert.equal(auditInvRes.headers.get("x-correlation-id"), testCorrelationId);

    // Query audit log directly from workspace store
    const auditLogs = await workspaceStore.audit(ownerUserId);
    const createdEvent = auditLogs.find(
      (e) => e.action === "invitation.created" && e.correlationId === testCorrelationId
    );
    assert.ok(
      createdEvent,
      "Expected attributable invitation.created audit event with correlationId"
    );
    assert.equal(createdEvent.userId, ownerUserId);
    assert.equal(createdEvent.workspaceId, workspaceId);
  });

  await t.test("12. Persistence across provider re-instantiation", async () => {
    // Re-create stores backed by the same database
    const freshWorkspaceProvider = new NeonHostedWorkspaceStateProvider(tenantId, pool);
    const freshWorkspaceStore = new HostedWorkspaceStore(process.cwd(), freshWorkspaceProvider);

    const members = await freshWorkspaceStore.listMembers(ownerUserId, workspaceId);
    assert.ok(members.length >= 3);
    assert.ok(members.some((m) => m.userId === ownerUserId && m.role === "owner"));
    assert.ok(members.some((m) => m.userId === adminUserId && m.role === "admin"));

    const invitations = await freshWorkspaceStore.listInvitations(ownerUserId, workspaceId);
    assert.ok(invitations.some((i) => i.recipientEmail === "audit@example.com"));
  });
});
