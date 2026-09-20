import assert from "node:assert/strict";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import {
  DELETE,
  GET,
  POST,
  resolveGitHubActionsDeployment,
} from "../src/app/api/hosted/deployments/route";
import { POST as resolveDeployment } from "../src/app/api/hosted/deployments/resolve/route";
import { POST as createWorkspace } from "../src/app/api/hosted/workspaces/route";
import { hostedDomainStoreForTenant } from "../src/server/hosted-domain/hosted-domain-store";
import {
  executeDeploymentWorkflow,
  resolveDeploymentWorkflowTarget,
  DeploymentWorkflowError,
} from "../src/server/hosted-deployments/deployment-workflow";
import { fallbackCredentialManager } from "../src/server/hosted-deployments/fallback-credentials";
import { VercelAdapter } from "../src/server/integrations/vercel-adapter";

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function readAudit(store: unknown) {
  return (
    await (
      store as {
        read: () => Promise<{
          audit: Array<{
            action: string;
            userId?: string;
            subjectId?: string;
            outcome?: string;
            workspaceId?: string;
          }>;
        }>;
      }
    ).read()
  ).audit;
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

test("Verify End-to-End Tenant Isolation: complete multi-tenant deployment pipeline", async () => {
  fallbackCredentialManager.clear();

  // 1. Multi-Tenant Setup
  const tenantA = `tenant-a-iso-${Date.now()}`;
  const tenantB = `tenant-b-iso-${Date.now()}`;
  const tenantC = `tenant-c-iso-${Date.now()}`; // Unconfigured tenant

  const adminA = `admin-a-${Date.now()}`;
  const adminB = `admin-b-${Date.now()}`;
  const adminC = `admin-c-${Date.now()}`;

  const originalOrgMap = process.env.GITHUB_ORG_MAP;
  process.env.GITHUB_ORG_MAP = JSON.stringify({
    [tenantA]: "acme",
    [tenantB]: "globex",
    [tenantC]: "initech",
  });

  try {
    const storeA = hostedDomainStoreForTenant(tenantA);
    const storeB = hostedDomainStoreForTenant(tenantB);
    const storeC = hostedDomainStoreForTenant(tenantC);

    // Create workspaces
    const wsRespA = await createWorkspace(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Tenant A Workspace" }),
      })
    );
    const workspaceA = ((await json(wsRespA)).workspace as { id: string }).id;

    const wsRespB = await createWorkspace(
      request(adminB, tenantB, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Tenant B Workspace" }),
      })
    );
    const workspaceB = ((await json(wsRespB)).workspace as { id: string }).id;

    const wsRespC = await createWorkspace(
      request(adminC, tenantC, "org:admin", {
        method: "POST",
        body: JSON.stringify({ name: "Tenant C Workspace" }),
      })
    );
    const workspaceC = ((await json(wsRespC)).workspace as { id: string }).id;

    // Configure Tenant A project mapping and repository
    const setProjectA = await POST(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "set-project",
          workspaceId: workspaceA,
          projectId: "prj_acme_core",
          teamId: "team_acme_core",
          webhookSecret: "wh_secret_a",
        }),
      })
    );
    assert.equal(setProjectA.status, 200);

    const regRepoA = await POST(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "register-repository",
          workspaceId: workspaceA,
          owner: "acme",
          repository: "frontend",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(regRepoA.status, 201);

    // Configure Tenant B project mapping and repository
    const setProjectB = await POST(
      request(adminB, tenantB, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "set-project",
          workspaceId: workspaceB,
          projectId: "prj_globex_ops",
          teamId: "team_globex_ops",
          webhookSecret: "wh_secret_b",
        }),
      })
    );
    assert.equal(setProjectB.status, 200);

    const regRepoB = await POST(
      request(adminB, tenantB, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "register-repository",
          workspaceId: workspaceB,
          owner: "globex",
          repository: "backend",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(regRepoB.status, 201);

    // Configure Tenant C: register repo but leave project mapping unconfigured
    const regRepoC = await POST(
      request(adminC, tenantC, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "register-repository",
          workspaceId: workspaceC,
          owner: "initech",
          repository: "billing",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(regRepoC.status, 201);

    // =========================================================================
    // 2. Acceptance Criterion: Cross-Tenant Access Is Rejected
    // =========================================================================

    // Tenant A attempts to mutate Tenant B's project mapping (cross-tenant workspace is not found)
    const crossMutate = await POST(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "set-project",
          workspaceId: workspaceB, // Cross-tenant workspace
          projectId: "prj_hacked",
          webhookSecret: "hacked",
        }),
      })
    );
    assert.equal(crossMutate.status, 404);

    // Tenant A attempts to delete Tenant B's project mapping
    const crossDelete = await DELETE(
      new Request(`http://localhost/api/hosted/deployments?workspaceId=${workspaceB}`, {
        method: "DELETE",
        headers: request(adminA, tenantA, "org:admin").headers,
      })
    );
    assert.equal(crossDelete.status, 404);

    // Tenant A attempts to query Tenant B's deployment configuration
    const crossQuery = await GET(
      new Request(`http://localhost/api/hosted/deployments?workspaceId=${workspaceB}`, {
        headers: request(adminA, tenantA, "org:admin").headers,
      })
    );
    assert.equal(crossQuery.status, 404);

    // Tenant A attempts to register a repository belonging to Tenant B's org
    const crossRepoReg = await POST(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "register-repository",
          workspaceId: workspaceA,
          owner: "globex",
          repository: "backend",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(crossRepoReg.status, 403);
    assert.match(
      String((await json(crossRepoReg)).error),
      /Repository owner must match the Tenant's configured GitHub organization/
    );

    // Resolver cross-tenant rejection: Tenant A context attempting to resolve Tenant B repo
    const crossResolve = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: { "x-hosted-tenant-id": tenantA },
      }),
      {},
      {
        owner: "globex",
        repository: "backend",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }
    );
    assert.equal(crossResolve.status, 403);
    assert.match(
      String((await json(crossResolve)).error),
      /Deployment repository is not allowed for this Tenant/
    );

    // Fallback credential cross-tenant rejection:
    // Create fallback credential for Tenant A on acme/frontend via API route
    const createCredA = await POST(
      request(adminA, tenantA, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "create-fallback-credential",
          workspaceId: workspaceA,
          owner: "acme",
          repository: "frontend",
          removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
        }),
      })
    );
    assert.equal(createCredA.status, 201);
    const { credential: credA, rawSecret: secretA } = (await json(createCredA)) as {
      credential: { id: string };
      rawSecret: string;
    };

    // Present Tenant A's fallback secret while requesting Tenant B's repo
    const crossFallbackResolve = await resolveDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretA}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          owner: "globex",
          repository: "backend",
        }),
      })
    );
    assert.equal(crossFallbackResolve.status, 403);
    assert.match(
      String((await json(crossFallbackResolve)).error),
      /Fallback credential repository owner does not match/
    );

    // Verify rejection audit was logged for Tenant A's credential
    const auditAAfterCross = await readAudit(storeA);
    const rejectedAudit = auditAAfterCross.find(
      (e) => e.action === "deployment.fallback_credential.rejected" && e.subjectId === credA.id
    );
    assert.ok(rejectedAudit);
    assert.equal(rejectedAudit.outcome, "denied");

    // =========================================================================
    // 3. Acceptance Criterion: Valid Same-Tenant Resolution Succeeds End-to-End
    // =========================================================================

    // OIDC steady-state resolution for Tenant A
    const mockVerifyTokenA = async () => ({
      audience: "developer-agentic-os",
      repository: "acme/frontend",
      repositoryOwner: "acme",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
    });

    const oidcResolveA = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer oidc-jwt-tenant-a",
          "x-hosted-tenant-id": tenantA,
        },
      }),
      {
        verifyToken:
          mockVerifyTokenA as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
      },
      { workspaceId: workspaceA }
    );
    assert.equal(oidcResolveA.status, 200);
    const targetA = (await json(oidcResolveA)) as { projectId: string; teamId?: string };
    assert.equal(targetA.projectId, "prj_acme_core");
    assert.equal(targetA.teamId, "team_acme_core");

    // OIDC steady-state resolution for Tenant B
    const mockVerifyTokenB = async () => ({
      audience: "developer-agentic-os",
      repository: "globex/backend",
      repositoryOwner: "globex",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
    });

    const oidcResolveB = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer oidc-jwt-tenant-b",
          "x-hosted-tenant-id": tenantB,
        },
      }),
      {
        verifyToken:
          mockVerifyTokenB as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
      },
      { workspaceId: workspaceB }
    );
    assert.equal(oidcResolveB.status, 200);
    const targetB = (await json(oidcResolveB)) as { projectId: string; teamId?: string };
    assert.equal(targetB.projectId, "prj_globex_ops");
    assert.equal(targetB.teamId, "team_globex_ops");

    // Valid fallback resolution for Tenant A
    const fallbackResolveA = await resolveDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretA}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: workspaceA,
          owner: "acme",
          repository: "frontend",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
        }),
      })
    );
    assert.equal(fallbackResolveA.status, 200);
    const fallbackTargetA = (await json(fallbackResolveA)) as {
      projectId: string;
      teamId?: string;
    };
    assert.equal(fallbackTargetA.projectId, "prj_acme_core");
    assert.equal(fallbackTargetA.teamId, "team_acme_core");

    // Workflow runner execution test: executeDeploymentWorkflow passes resolved target
    let executedTarget: unknown = null;
    const workflowResult = await executeDeploymentWorkflow({
      endpointUrl: "http://localhost/api/hosted/deployments/resolve",
      oidcToken: "mock-token",
      fetcher: (async () =>
        new Response(JSON.stringify(targetA), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
      deployer: async (t) => {
        executedTarget = t;
        return { success: true };
      },
    });
    assert.deepEqual(executedTarget, { projectId: "prj_acme_core", teamId: "team_acme_core" });
    assert.equal(workflowResult.status, "deployed");

    // =========================================================================
    // 4. Acceptance Criterion: Missing Configuration Fails with deployment_unconfigured
    // =========================================================================

    // Tenant C has repo registered but NO Vercel project mapping
    const mockVerifyTokenC = async () => ({
      audience: "developer-agentic-os",
      repository: "initech/billing",
      repositoryOwner: "initech",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
    });

    const unconfiguredResolve = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer oidc-jwt-tenant-c",
          "x-hosted-tenant-id": tenantC,
        },
      }),
      {
        verifyToken:
          mockVerifyTokenC as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
      },
      { workspaceId: workspaceC }
    );
    assert.equal(unconfiguredResolve.status, 409);
    assert.equal(String((await json(unconfiguredResolve)).error), "deployment_unconfigured");

    // Unregistered repo returns 404
    const unregisteredResolve = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: { "x-hosted-tenant-id": tenantA },
      }),
      {},
      {
        owner: "acme",
        repository: "unregistered-service",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }
    );
    assert.equal(unregisteredResolve.status, 404);

    // resolveDeploymentWorkflowTarget throws UNCONFIGURED on 409
    await assert.rejects(
      async () => {
        await resolveDeploymentWorkflowTarget({
          endpointUrl: "http://localhost/api/hosted/deployments/resolve",
          oidcToken: "unconfigured-token",
          fetcher: (async () =>
            new Response(JSON.stringify({ error: "deployment_unconfigured" }), {
              status: 409,
              headers: { "content-type": "application/json" },
            })) as typeof fetch,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DeploymentWorkflowError);
        assert.equal(err.code, "UNCONFIGURED");
        return true;
      }
    );

    // executeDeploymentWorkflow blocks deployer when UNCONFIGURED occurs
    let deployerRanOnUnconfigured = false;
    const unconfiguredWorkflowResult = await executeDeploymentWorkflow({
      endpointUrl: "http://localhost/api/hosted/deployments/resolve",
      oidcToken: "mock-token",
      fetcher: (async () =>
        new Response(JSON.stringify({ error: "deployment_unconfigured" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
      deployer: async () => {
        deployerRanOnUnconfigured = true;
      },
    });
    assert.equal(deployerRanOnUnconfigured, false);
    assert.equal(unconfiguredWorkflowResult.status, "unconfigured");

    // =========================================================================
    // 5. Acceptance Criterion: Mapping Deletion Preserves Registrations & Blocks Deployment
    // =========================================================================

    // Delete Tenant A's Vercel project mapping
    const deleteRespA = await DELETE(
      new Request(`http://localhost/api/hosted/deployments?workspaceId=${workspaceA}`, {
        method: "DELETE",
        headers: request(adminA, tenantA, "org:admin").headers,
      })
    );
    assert.equal(deleteRespA.status, 200);

    // Registrations remain intact in state!
    const reposAfterDeleteA = await storeA.listGitHubRepositories(adminA, workspaceA);
    assert.equal(reposAfterDeleteA.length, 1);
    assert.equal(reposAfterDeleteA[0]?.repository, "frontend");

    // Subsequent resolution for Tenant A fails closed with 409 (unconfigured)
    const resolveAfterDeleteA = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer oidc-jwt-tenant-a",
          "x-hosted-tenant-id": tenantA,
        },
      }),
      {
        verifyToken:
          mockVerifyTokenA as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
      },
      { workspaceId: workspaceA }
    );
    assert.equal(resolveAfterDeleteA.status, 409);

    // Tenant B's resolution remains green and completely unaffected!
    const resolveTenantBStillOk = await resolveGitHubActionsDeployment(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        method: "POST",
        headers: {
          authorization: "Bearer oidc-jwt-tenant-b",
          "x-hosted-tenant-id": tenantB,
        },
      }),
      {
        verifyToken:
          mockVerifyTokenB as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
      },
      { workspaceId: workspaceB }
    );
    assert.equal(resolveTenantBStillOk.status, 200);
    assert.equal(
      ((await json(resolveTenantBStillOk)) as { projectId: string }).projectId,
      "prj_globex_ops"
    );

    // =========================================================================
    // 6. Acceptance Criterion: Mapping Replacement Preserves Historical Targets
    // =========================================================================

    // Tenant B replaces project mapping with a new target
    const replaceProjectB = await POST(
      request(adminB, tenantB, "org:admin", {
        method: "POST",
        body: JSON.stringify({
          action: "set-project",
          workspaceId: workspaceB,
          projectId: "prj_globex_v2",
          teamId: "team_globex_v2",
          webhookSecret: "wh_secret_b2",
        }),
      })
    );
    assert.equal(replaceProjectB.status, 200);

    // Check Tenant B's history: historical target prj_globex_ops is preserved!
    const historyB = await storeB.listVercelProjectHistory(adminB, workspaceB);
    assert.equal(historyB.length, 1);
    assert.equal(historyB[0]?.projectId, "prj_globex_ops");
    assert.equal(historyB[0]?.teamId, "team_globex_ops");

    // Check Tenant A's history: completely isolated, contains zero Tenant B targets
    const historyA = await storeA.listVercelProjectHistory(adminA, workspaceA);
    assert.equal(historyA.length, 0);

    // =========================================================================
    // 7. Acceptance Criterion: Audit Events Are Emitted and Tenant-Isolated
    // =========================================================================

    // Tenant A audit logs
    const auditA = await storeA.audit(adminA, workspaceA);
    const actionsA = auditA.map((e) => e.action);
    assert.ok(actionsA.includes("vercel.project.mapping.updated"));
    assert.ok(actionsA.includes("vercel.project.mapping.removed"));
    assert.ok(actionsA.includes("github.repository.registered"));
    assert.ok(actionsA.includes("deployment.fallback_credential.created"));

    // Tenant B audit logs
    const auditB = await storeB.audit(adminB, workspaceB);
    const actionsB = auditB.map((e) => e.action);
    assert.ok(actionsB.includes("vercel.project.mapping.updated"));
    assert.ok(actionsB.includes("github.repository.registered"));

    // Tenant C audit logs
    const auditC = await storeC.audit(adminC, workspaceC);
    assert.ok(
      !auditC.some((e) => e.repositoryId?.includes("acme") || e.repositoryId?.includes("globex"))
    );

    // Ensure strict isolation: No Tenant B events in Tenant A's audit
    assert.ok(
      !auditA.some((e) => e.repositoryId?.includes("globex") || e.subjectId?.includes("globex"))
    );
    // Ensure strict isolation: No Tenant A events in Tenant B's audit
    assert.ok(
      !auditB.some((e) => e.repositoryId?.includes("acme") || e.subjectId?.includes("acme"))
    );

    // =========================================================================
    // 8. Acceptance Criterion: Existing Vercel Adapter Regression Remains Green
    // =========================================================================

    const adapter = new VercelAdapter(
      {
        VERCEL_TOKEN: "mock-vercel-token",
        VERCEL_PROJECT_ID: targetB.projectId,
        VERCEL_TEAM_ID: targetB.teamId,
      },
      async (input) => {
        assert.match(String(input), new RegExp(`projectId=${targetB.projectId}`));
        assert.match(String(input), new RegExp(`teamId=${targetB.teamId}`));
        return new Response(
          JSON.stringify({
            deployments: [
              {
                uid: "dpl_globex_1",
                name: "backend",
                url: "backend-globex.vercel.app",
                state: "READY",
                created: 1893456000000,
                target: "production",
              },
            ],
          }),
          { status: 200 }
        );
      }
    );

    const ops = await adapter.getOperations();
    assert.equal(ops.status, "healthy");
    assert.equal(ops.projectId, targetB.projectId);
    assert.equal(ops.deployments[0]?.state, "ready");
    assert.equal(ops.deployments[0]?.buildLogUrl, "https://vercel.com/deployments/dpl_globex_1");
    assert.equal(ops.deployments[0]?.runtimeLogUrl, `https://vercel.com/${targetB.projectId}/logs`);
  } finally {
    if (originalOrgMap === undefined) delete process.env.GITHUB_ORG_MAP;
    else process.env.GITHUB_ORG_MAP = originalOrgMap;
  }
});
