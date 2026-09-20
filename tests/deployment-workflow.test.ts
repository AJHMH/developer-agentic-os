import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import {
  DeploymentWorkflowError,
  executeDeploymentWorkflow,
  resolveDeploymentWorkflowTarget,
  type DeploymentTarget,
} from "../src/server/hosted-deployments/deployment-workflow";
import { runResolveDeployment } from "../scripts/resolve-deployment";
import { VercelAdapter } from "../src/server/integrations/vercel-adapter";
import { HostedDomainStore } from "../src/server/hosted-domain/hosted-domain-store";

test("resolveDeploymentWorkflowTarget successfully resolves project and team target", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fakeFetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(
      JSON.stringify({
        projectId: "prj_tenant_123",
        teamId: "team_tenant_abc",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const target = await resolveDeploymentWorkflowTarget({
    endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
    oidcToken: "mock-valid-oidc-token",
    fetcher: fakeFetcher as typeof fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://hub.test/api/hosted/deployments/resolve");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer mock-valid-oidc-token");
  assert.deepEqual(target, {
    projectId: "prj_tenant_123",
    teamId: "team_tenant_abc",
  });
});

test("resolveDeploymentWorkflowTarget handles missing teamId gracefully", async () => {
  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ projectId: "prj_solo" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const target = await resolveDeploymentWorkflowTarget({
    endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
    oidcToken: "mock-token",
    fetcher: fakeFetcher as typeof fetch,
  });

  assert.deepEqual(target, { projectId: "prj_solo" });
});

test("resolveDeploymentWorkflowTarget throws UNCONFIGURED on 409 deployment_unconfigured", async () => {
  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "deployment_unconfigured" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () =>
      resolveDeploymentWorkflowTarget({
        endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
        oidcToken: "mock-token",
        fetcher: fakeFetcher as typeof fetch,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentWorkflowError);
      assert.equal(error.code, "UNCONFIGURED");
      assert.equal(error.message, "deployment_unconfigured");
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test("resolveDeploymentWorkflowTarget throws FORBIDDEN on 403 authorization failures", async () => {
  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "Deployment identity is not allowed." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () =>
      resolveDeploymentWorkflowTarget({
        endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
        oidcToken: "mock-token",
        fetcher: fakeFetcher as typeof fetch,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentWorkflowError);
      assert.equal(error.code, "FORBIDDEN");
      assert.equal(error.message, "Deployment identity is not allowed.");
      return true;
    }
  );
});

test("resolveDeploymentWorkflowTarget throws NOT_FOUND on 404 unregistered repo", async () => {
  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "Repository registration was not found." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    () =>
      resolveDeploymentWorkflowTarget({
        endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
        oidcToken: "mock-token",
        fetcher: fakeFetcher as typeof fetch,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentWorkflowError);
      assert.equal(error.code, "NOT_FOUND");
      return true;
    }
  );
});

test("executeDeploymentWorkflow executes deployer only when resolution succeeds", async () => {
  let deployerCalled = false;
  let receivedTarget: DeploymentTarget | null = null;

  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ projectId: "prj_prod", teamId: "team_prod" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await executeDeploymentWorkflow({
    endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
    oidcToken: "mock-token",
    fetcher: fakeFetcher as typeof fetch,
    deployer: async (target) => {
      deployerCalled = true;
      receivedTarget = target;
      return { deploymentId: "dpl_xyz", url: "https://app.vercel.app" };
    },
  });

  assert.equal(deployerCalled, true);
  assert.deepEqual(receivedTarget, { projectId: "prj_prod", teamId: "team_prod" });
  assert.equal(result.status, "deployed");
  if (result.status === "deployed") {
    assert.deepEqual(result.target, { projectId: "prj_prod", teamId: "team_prod" });
    assert.deepEqual(result.result, { deploymentId: "dpl_xyz", url: "https://app.vercel.app" });
  }
});

test("executeDeploymentWorkflow never calls deployer when deployment_unconfigured occurs", async () => {
  let deployerCalled = false;

  const fakeFetcher = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "deployment_unconfigured" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

  const result = await executeDeploymentWorkflow({
    endpointUrl: "https://hub.test/api/hosted/deployments/resolve",
    oidcToken: "mock-token",
    fetcher: fakeFetcher as typeof fetch,
    deployer: async () => {
      deployerCalled = true;
      return { deployed: true };
    },
  });

  assert.equal(deployerCalled, false);
  assert.equal(result.status, "unconfigured");
  assert.equal(result.target, null);
});

test("resolved deployment target works seamlessly with VercelAdapter", async () => {
  const target: DeploymentTarget = {
    projectId: "prj_adapter_compat",
    teamId: "team_adapter_compat",
  };

  const adapter = new VercelAdapter(
    {
      VERCEL_TOKEN: "mock-vercel-token",
      VERCEL_PROJECT_ID: target.projectId,
      VERCEL_TEAM_ID: target.teamId,
    },
    async (input) => {
      assert.match(String(input), /projectId=prj_adapter_compat/);
      assert.match(String(input), /teamId=team_adapter_compat/);
      return new Response(
        JSON.stringify({
          deployments: [
            {
              uid: "dpl_resolved_1",
              name: "checkout",
              url: "checkout-abc.vercel.app",
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
  assert.equal(ops.projectId, "prj_adapter_compat");
  assert.equal(ops.deployments[0]?.state, "ready");
  assert.equal(ops.deployments[0]?.buildLogUrl, "https://vercel.com/deployments/dpl_resolved_1");
  assert.equal(ops.deployments[0]?.runtimeLogUrl, "https://vercel.com/prj_adapter_compat/logs");
});

test("historical deployment target data is preserved across project mapping replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-history-test-"));
  try {
    const store = new HostedDomainStore(root);
    const workspace = await store.createWorkspace("admin-1", "Prod Workspace");

    // 1. Initial mapping to Project A
    const mappingA = await store.setVercelProject("admin-1", workspace.id, {
      projectId: "prj_alpha",
      teamId: "team_alpha",
    });
    assert.equal(mappingA.projectId, "prj_alpha");

    // Record resolution under Project A
    await store.recordDeploymentResolution(
      "github-actions:acme/repo",
      "allowed",
      "acme/repo",
      { projectId: "prj_alpha", teamId: "team_alpha" },
      workspace.id
    );

    // 2. Update mapping to Project B
    const mappingB = await store.setVercelProject("admin-1", workspace.id, {
      projectId: "prj_beta",
      teamId: "team_beta",
    });
    assert.equal(mappingB.projectId, "prj_beta");

    // Verify active project is Project B
    const currentProject = await store.getVercelProject("admin-1", workspace.id);
    assert.equal(currentProject?.projectId, "prj_beta");

    // Verify history retained Project A
    const history = await store.listVercelProjectHistory("admin-1", workspace.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.projectId, "prj_alpha");
    assert.equal(history[0]?.teamId, "team_alpha");

    // Verify historical resolution record retained Project A
    const records = await store.listAllRecords("admin-1", workspace.id);
    const firstRun = records.automationRuns?.[0];
    assert.equal(firstRun?.projectId, "prj_alpha");
    assert.equal(firstRun?.teamId, "team_alpha");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runResolveDeployment script exits cleanly with configured=false on deployment_unconfigured", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "gh-output-"));
  const outputFile = join(tempDir, "output.txt");

  const originalEnv = { ...process.env };
  process.env.ACTIONS_ID_TOKEN = "mock-oidc-token";
  process.env.DEVELOPER_AGENTIC_OS_HOST = "https://app.test";
  process.env.GITHUB_OUTPUT = outputFile;

  try {
    const fakeFetcher = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: "deployment_unconfigured" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });

    const exitCode = await runResolveDeployment([], fakeFetcher as typeof fetch);
    assert.equal(exitCode, 0);

    const { readFile } = await import("node:fs/promises");
    const outputContent = await readFile(outputFile, "utf8");
    assert.match(outputContent, /configured=false/);
  } finally {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});
