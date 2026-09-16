import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { GET as getSession } from "../src/app/api/hosted/auth/session/route";
import {
  GET as listWorkspaces,
  POST as createWorkspace,
} from "../src/app/api/hosted/workspaces/route";
import { POST as selectWorkspace } from "../src/app/api/hosted/workspaces/[id]/select/route";
import { AuthError, DeterministicAuthAdapter } from "../src/server/hosted-auth/auth-adapter";
import { HostedWorkspaceStore } from "../src/server/hosted-workspaces/hosted-workspace-store";

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function request(userId?: string, init: RequestInit = {}, tenantId?: string): Request {
  const headers = new Headers(init.headers);
  if (userId) headers.set("x-hosted-user-id", userId);
  if (tenantId) headers.set("x-hosted-tenant-id", tenantId);
  return new Request("http://localhost/api/hosted", { ...init, headers });
}

test("deterministic auth adapter resolves explicit identities and rejects anonymous requests", async () => {
  const adapter = new DeterministicAuthAdapter();
  assert.deepEqual(await adapter.authenticate(request("user-alice", {}, "tenant-acme")), {
    userId: "user-alice",
    tenantId: "tenant-acme",
    displayName: "user-alice",
  });
  await assert.rejects(
    () => adapter.authenticate(request()),
    (error: unknown) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, "UNAUTHENTICATED");
      return true;
    }
  );
});

test("the same hosted user is isolated between tenant contexts", async () => {
  const userId = `multi-tenant-${Date.now()}`;
  const acme = await listWorkspaces(request(userId, {}, "tenant-acme"));
  const stripe = await listWorkspaces(request(userId, {}, "tenant-stripe"));
  const acmeWorkspace = (await body(acme)).activeWorkspace as { id: string };
  const stripeWorkspace = (await body(stripe)).activeWorkspace as { id: string };

  assert.notEqual(acmeWorkspace.id, stripeWorkspace.id);
  const crossTenant = await selectWorkspace(request(userId, { method: "POST" }, "tenant-stripe"), {
    params: Promise.resolve({ id: acmeWorkspace.id }),
  });
  assert.equal(crossTenant.status, 404);
});

test("hosted workspaces are private, switchable, and audited per user", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-hosted-"));
  try {
    const store = new HostedWorkspaceStore(root);
    const first = await store.create("alice", "Personal");
    const second = await store.create("alice", "Client");
    await store.select("alice", second.id);
    assert.deepEqual(
      (await store.list("alice")).map((workspace) => workspace.name),
      ["Personal", "Client"]
    );
    const active = await store.active("alice");
    assert.ok(active);
    assert.equal(active.id, second.id);
    assert.deepEqual(await store.list("bob"), []);
    await assert.rejects(() => store.select("bob", first.id), /Workspace not found/);
    assert.deepEqual(
      (await store.audit("alice")).map((event) => event.action),
      ["workspace.created", "workspace.created", "workspace.selected"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hosted workspace JSON storage is rejected outside the explicit fixture boundary", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  const previousFixtureMode = environment.HOSTED_JSON_FIXTURE_MODE;
  const previousAuthFixtureMode = environment.HOSTED_AUTH_FIXTURE_MODE;
  environment.NODE_ENV = "production";
  delete environment.HOSTED_AUTH_FIXTURE_MODE;
  delete environment.HOSTED_JSON_FIXTURE_MODE;
  try {
    const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-production-workspace-"));
    try {
      await assert.rejects(() => new HostedWorkspaceStore(root).list("alice"), /fixture-only/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
    if (previousFixtureMode === undefined) delete environment.HOSTED_JSON_FIXTURE_MODE;
    else environment.HOSTED_JSON_FIXTURE_MODE = previousFixtureMode;
    if (previousAuthFixtureMode === undefined) delete environment.HOSTED_AUTH_FIXTURE_MODE;
    else environment.HOSTED_AUTH_FIXTURE_MODE = previousAuthFixtureMode;
  }
});

test("hosted routes require identity and isolate workspace selection", async () => {
  const anonymous = await listWorkspaces(request());
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await body(anonymous), { error: "Authentication is required." });

  const created = await createWorkspace(
    request("route-alice", {
      method: "POST",
      body: JSON.stringify({ name: "Alice private" }),
    })
  );
  assert.equal(created.status, 201);
  const workspace = (await body(created)).workspace as { id: string; ownerId: string };
  assert.equal(workspace.ownerId, "route-alice");

  const aliceList = await listWorkspaces(request("route-alice"));
  assert.equal((await body(aliceList)).workspaces instanceof Array, true);
  const bobList = await listWorkspaces(request("route-bob"));
  const bobWorkspaces = (await body(bobList)).workspaces as Array<{
    id: string;
    ownerId: string;
    name: string;
  }>;
  assert.equal(bobWorkspaces.length, 1);
  assert.equal(bobWorkspaces[0].ownerId, "route-bob");
  assert.equal(bobWorkspaces[0].name, "Personal");
  assert.notEqual(bobWorkspaces[0].id, workspace.id);

  const crossUser = await selectWorkspace(request("route-bob", { method: "POST" }), {
    params: Promise.resolve({ id: workspace.id }),
  });
  assert.equal(crossUser.status, 404);
  assert.deepEqual(await body(crossUser), { error: "Workspace not found." });

  const session = await getSession(request("route-alice"));
  assert.deepEqual(await body(session), {
    identity: {
      userId: "route-alice",
      tenantId: "personal:route-alice",
      displayName: "route-alice",
    },
  });
});

test("first hosted workspace request provisions one active personal workspace", async () => {
  const userId = `first-login-${Date.now()}`;

  const firstResponse = await listWorkspaces(request(userId));
  assert.equal(firstResponse.status, 200);
  const firstBody = (await body(firstResponse)) as {
    workspaces: Array<{ id: string; name: string }>;
    activeWorkspace: { id: string; name: string };
  };
  assert.equal(firstBody.workspaces.length, 1);
  assert.equal(firstBody.workspaces[0].name, "Personal");
  assert.equal(firstBody.activeWorkspace.id, firstBody.workspaces[0].id);

  const secondBody = (await body(await listWorkspaces(request(userId)))) as {
    workspaces: Array<{ id: string }>;
    activeWorkspace: { id: string };
  };
  assert.equal(secondBody.workspaces.length, 1);
  assert.equal(secondBody.activeWorkspace.id, firstBody.activeWorkspace.id);
});
