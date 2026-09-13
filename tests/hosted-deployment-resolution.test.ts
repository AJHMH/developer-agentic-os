import assert from "node:assert/strict";
import test from "node:test";

import {
  DeploymentResolutionError,
  resolveDeploymentTarget,
  type DeploymentRegistry,
} from "../src/server/hosted-deployments/deployment-resolution";

const registry: DeploymentRegistry = {
  async findRepository(tenantId, owner, repository) {
    if (tenantId !== "tenant-acme" || owner !== "acme" || repository !== "checkout") return null;
    return {
      tenantId,
      owner,
      repository,
      workflow: "deploy.yml",
      ref: "refs/heads/main",
    };
  },
  async findProject(tenantId) {
    return tenantId === "tenant-acme" ? { projectId: "prj_acme", teamId: "team_acme" } : null;
  },
};

test("deployment resolver returns the tenant project for a matching workflow identity", async () => {
  assert.deepEqual(
    await resolveDeploymentTarget(registry, {
      tenantId: "tenant-acme",
      owner: "acme",
      repository: "checkout",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
      audience: "developer-agentic-os",
    }),
    { projectId: "prj_acme", teamId: "team_acme" }
  );
});

test("deployment resolver rejects an invalid workflow identity", async () => {
  await assert.rejects(
    () =>
      resolveDeploymentTarget(registry, {
        tenantId: "tenant-acme",
        owner: "acme",
        repository: "checkout",
        workflow: "untrusted.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentResolutionError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    }
  );
});

test("deployment resolver fails closed when the tenant mapping is absent", async () => {
  const noMapping: DeploymentRegistry = {
    ...registry,
    findProject: async () => null,
  };
  await assert.rejects(
    () =>
      resolveDeploymentTarget(noMapping, {
        tenantId: "tenant-acme",
        owner: "acme",
        repository: "checkout",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
        audience: "developer-agentic-os",
      }),
    (error: unknown) => {
      assert.ok(error instanceof DeploymentResolutionError);
      assert.equal(error.code, "UNCONFIGURED");
      assert.equal(error.message, "deployment_unconfigured");
      return true;
    }
  );
});
