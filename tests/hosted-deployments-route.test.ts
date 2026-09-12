import assert from "node:assert/strict";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { DELETE, GET, POST } from "../src/app/api/hosted/deployments/route";
import { POST as createWorkspace } from "../src/app/api/hosted/workspaces/route";

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function request(
  userId: string,
  tenantId: string,
  role: "org:admin" | "org:member",
  init: RequestInit = {}
): Request {
  const headers = new Headers(init.headers);
  headers.set("x-hosted-user-id", userId);
  headers.set("x-hosted-tenant-id", tenantId);
  headers.set("x-hosted-org-role", role);
  return new Request("http://localhost/api/hosted/deployments", { ...init, headers });
}

test("hosted deployment route protects mapping mutations and fails closed after deletion", async () => {
  const tenantId = `tenant-deployments-${Date.now()}`;
  const userId = `admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "Deployment workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  const memberAttempt = await POST(
    request("member", tenantId, "org:member", {
      method: "POST",
      body: JSON.stringify({ action: "set-project", workspaceId, projectId: "prj_denied" }),
    })
  );
  assert.equal(memberAttempt.status, 403);

  const mapping = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ action: "set-project", workspaceId, projectId: "prj_acme" }),
    })
  );
  assert.equal(mapping.status, 200);

  const wrongOwner = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        owner: "other-org",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
      }),
    })
  );
  assert.equal(wrongOwner.status, 403);

  const registration = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
      }),
    })
  );
  assert.equal(registration.status, 201);

  const resolved = await POST(
    request("workflow", tenantId, "org:member", {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        workspaceId,
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    })
  );
  assert.equal(resolved.status, 200);
  const resolvedBody = await json(resolved);
  assert.equal(resolvedBody.projectId, "prj_acme");
  assert.equal(typeof resolvedBody.updatedAt, "string");

  const deleted = await DELETE(
    new Request(
      `http://localhost/api/hosted/deployments?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE", headers: request(userId, tenantId, "org:admin").headers }
    )
  );
  assert.equal(deleted.status, 200);

  const unconfigured = await POST(
    request("workflow", tenantId, "org:member", {
      method: "POST",
      body: JSON.stringify({
        action: "resolve",
        workspaceId,
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    })
  );
  assert.equal(unconfigured.status, 409);
  assert.deepEqual(await json(unconfigured), { error: "deployment_unconfigured" });
});

test("hosted deployment route exposes tenant-scoped mapping and registrations", async () => {
  const tenantId = `tenant-list-${Date.now()}`;
  const userId = `list-admin-${Date.now()}`;
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "List workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;
  const response = await GET(
    new Request(
      `http://localhost/api/hosted/deployments?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: request(userId, tenantId, "org:admin").headers }
    )
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { project: null, repositories: [] });
});
