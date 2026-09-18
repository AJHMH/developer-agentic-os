import assert from "node:assert/strict";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { DELETE, GET, POST } from "../src/app/api/hosted/deployments/route";
import { POST as resolveDeployment } from "../src/app/api/hosted/deployments/resolve/route";
import { hostedDomainStoreForTenant } from "../src/server/hosted-domain/hosted-domain-store";
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
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_denied",
        webhookSecret: "denied-secret",
      }),
    })
  );
  assert.equal(memberAttempt.status, 403);

  const mapping = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_acme",
        webhookSecret: "acme-secret",
      }),
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

  const missingRepository = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        owner: "acme",
        repository: "",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
      }),
    })
  );
  assert.equal(missingRepository.status, 400);

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
  const storedRecords = await hostedDomainStoreForTenant(tenantId).listAllRecords(userId, workspaceId);
  assert.equal(storedRecords.automationRuns?.length, 1);
  assert.equal(storedRecords.automationRuns?.[0]?.projectId, "prj_acme");
  assert.equal(storedRecords.automationRuns?.[0]?.workspaceId, workspaceId);

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

test("hosted deployment resolve action works without hosted user identity headers", async () => {
  const tenantId = `tenant-public-resolve-${Date.now()}`;
  const userId = `resolve-admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "Public resolve workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  const mapping = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_public",
        webhookSecret: "public-secret",
      }),
    })
  );
  assert.equal(mapping.status, 200);

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

  const publicResolve = await POST(
    new Request("http://localhost/api/hosted/deployments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosted-tenant-id": tenantId,
      },
      body: JSON.stringify({
        action: "resolve",
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    })
  );
  assert.equal(publicResolve.status, 200);
  const resolvedBody = await json(publicResolve);
  assert.equal(resolvedBody.projectId, "prj_public");
});

test("dedicated hosted deployment resolve route honors fixture-mode request bodies", async () => {
  const tenantId = `tenant-resolve-route-${Date.now()}`;
  const userId = `resolve-route-admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "Dedicated resolve workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  const mapping = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_resolve_route",
        webhookSecret: "resolve-route-secret",
      }),
    })
  );
  assert.equal(mapping.status, 200);

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

  const response = await resolveDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosted-tenant-id": tenantId,
      },
      body: JSON.stringify({
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    })
  );

  assert.equal(response.status, 200);
  const resolvedBody = await json(response);
  assert.equal(resolvedBody.projectId, "prj_resolve_route");
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

test("hosted deployment route rejects repository registration without a tenant org mapping", async () => {
  const tenantId = `tenant-unmapped-${Date.now()}`;
  const userId = `unmapped-admin-${Date.now()}`;
  const originalOrgMap = process.env.GITHUB_ORG_MAP;
  process.env.GITHUB_ORG_MAP = JSON.stringify({});
  try {
    const workspaceResponse = await createWorkspace(
      request(userId, tenantId, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Unmapped workspace" }),
      })
    );
    const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;
    const response = await POST(
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
    assert.equal(response.status, 403);
  } finally {
    if (originalOrgMap === undefined) delete process.env.GITHUB_ORG_MAP;
    else process.env.GITHUB_ORG_MAP = originalOrgMap;
  }
});

test("hosted deployment route reports unknown actions before workspace validation", async () => {
  const response = await POST(
    new Request("http://localhost/api/hosted/deployments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unsupported-action" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: "Unknown deployment action." });
});

test("hosted deployment mappings and resolution stay isolated between tenants", async () => {
  const sharedUserId = `multi-tenant-admin-${Date.now()}`;
  const tenantA = `tenant-a-${Date.now()}`;
  const tenantB = `tenant-b-${Date.now()}`;
  const originalOrgMap = process.env.GITHUB_ORG_MAP;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantA]: "acme", [tenantB]: "stripe" });
  try {
    const workspaceAResponse = await createWorkspace(
      request(sharedUserId, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Tenant A" }),
      })
    );
    const workspaceAId = ((await json(workspaceAResponse)).workspace as { id: string }).id;
    const workspaceBResponse = await createWorkspace(
      request(sharedUserId, tenantB, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Tenant B" }),
      })
    );
    const workspaceBId = ((await json(workspaceBResponse)).workspace as { id: string }).id;

    const mappingResponse = await POST(
      request(sharedUserId, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "set-project",
          workspaceId: workspaceAId,
          projectId: "prj_tenant_a",
          webhookSecret: "secret-a",
        }),
      })
    );
    assert.equal(mappingResponse.status, 200);
    const mappingBody = (await json(mappingResponse)) as {
      project: { projectId: string; updatedAt: string };
    };
    const registrationResponse = await POST(
      request(sharedUserId, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "register-repository",
          workspaceId: workspaceAId,
          owner: "acme",
          repository: "checkout",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(registrationResponse.status, 201);
    const registrationBody = (await json(registrationResponse)) as {
      repository: {
        id: string;
        tenantId: string;
        owner: string;
        repository: string;
        workflow: string;
        ref: string;
        createdAt: string;
      };
    };

    const tenantAView = await GET(
      new Request(
        `http://localhost/api/hosted/deployments?workspaceId=${encodeURIComponent(workspaceAId)}`,
        { headers: request(sharedUserId, tenantA, "org:admin").headers }
      )
    );
    assert.deepEqual(await json(tenantAView), {
      project: {
        projectId: "prj_tenant_a",
        updatedAt: mappingBody.project.updatedAt,
      },
      repositories: [
        {
          id: registrationBody.repository.id,
          tenantId: tenantA,
          owner: "acme",
          repository: "checkout",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
          createdAt: registrationBody.repository.createdAt,
        },
      ],
    });

    const tenantBView = await GET(
      new Request(
        `http://localhost/api/hosted/deployments?workspaceId=${encodeURIComponent(workspaceBId)}`,
        { headers: request(sharedUserId, tenantB, "org:admin").headers }
      )
    );
    assert.equal(tenantBView.status, 200);
    assert.deepEqual(await json(tenantBView), { project: null, repositories: [] });

    const crossTenantResolve = await POST(
      request("workflow", tenantB, "org:member", {
        method: "POST",
        body: JSON.stringify({
          action: "resolve",
          workspaceId: workspaceBId,
          owner: "acme",
          repository: "checkout",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
          audience: "developer-agentic-os",
        }),
      })
    );
    assert.equal(crossTenantResolve.status, 403);
    assert.deepEqual(await json(crossTenantResolve), {
      error: "Deployment repository is not allowed for this Tenant.",
    });
    assert.deepEqual(
      await hostedDomainStoreForTenant(tenantB).listAllRecords(sharedUserId, workspaceBId),
      {}
    );
  } finally {
    if (originalOrgMap === undefined) delete process.env.GITHUB_ORG_MAP;
    else process.env.GITHUB_ORG_MAP = originalOrgMap;
  }
});
