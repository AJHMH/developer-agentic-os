import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";

import { POST as resolveDeploymentRoute } from "../src/app/api/hosted/deployments/resolve/route";
import { verifyGitHubActionsOidcToken } from "../src/server/hosted-deployments/github-actions-oidc";
import {
  DeploymentResolutionError,
  resolveDeploymentTarget,
} from "../src/server/hosted-deployments/deployment-resolution";

const expectedAudience = "developer-agentic-os";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function token(overrides: Record<string, unknown> = {}, signingKey = privateKey): string {
  const header = encode({ alg: "RS256", kid: "test-key" });
  const payload = encode({
    iss: "https://token.actions.githubusercontent.com",
    aud: expectedAudience,
    exp: Math.floor(Date.now() / 1000) + 300,
    repository: "acme/checkout",
    repository_owner: "acme",
    workflow_ref: "acme/checkout/.github/workflows/deploy.yml@refs/heads/main",
    ref: "refs/heads/main",
    ...overrides,
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(signingKey).toString("base64url")}`;
}

function fetchJwks(): typeof fetch {
  return async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key" }] }));
}

test("OIDC verifier accepts a valid signed GitHub Actions token", async () => {
  assert.deepEqual(
    await verifyGitHubActionsOidcToken(token(), expectedAudience, fetchJwks()),
    {
      audience: expectedAudience,
      repository: "acme/checkout",
      repositoryOwner: "acme",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
    }
  );
});

test("OIDC verifier rejects invalid token claims and signatures", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["wrong issuer", { iss: "https://example.test" }],
    ["wrong audience", { aud: "another-app" }],
    ["expired token", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["missing repository", { repository: undefined }],
    ["wrong repository owner", { repository: "other/checkout" }],
    ["wrong workflow repository", { workflow_ref: "other/checkout/.github/workflows/deploy.yml@refs/heads/main" }],
  ];

  for (const [name, overrides] of cases) {
    await assert.rejects(
      () => verifyGitHubActionsOidcToken(token(overrides), expectedAudience, fetchJwks()),
      (error: unknown) => error instanceof Error,
      name
    );
  }

  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(
    () => verifyGitHubActionsOidcToken(token({}, otherKey), expectedAudience, fetchJwks()),
    /signature is invalid/
  );
});

test("deployment resolver rejects wrong ref, unknown repository, and missing tenant mapping", async () => {
  const registry = {
    findRepository: async (tenantId: string, owner: string, repository: string) =>
      tenantId === "tenant-acme" && owner === "acme" && repository === "checkout"
        ? { tenantId, owner, repository, workflow: "deploy.yml", ref: "refs/heads/main" }
        : null,
    findProject: async (tenantId: string) =>
      tenantId === "tenant-acme" ? { projectId: "prj_acme" } : null,
  };

  for (const request of [
    {
      tenantId: "tenant-acme",
      owner: "acme",
      repository: "checkout",
      workflow: "deploy.yml",
      ref: "refs/heads/feature",
      audience: expectedAudience,
    },
    {
      tenantId: "tenant-acme",
      owner: "acme",
      repository: "unknown",
      workflow: "deploy.yml",
      ref: "refs/heads/main",
      audience: expectedAudience,
    },
  ]) {
    await assert.rejects(() => resolveDeploymentTarget(registry, request), DeploymentResolutionError);
  }

  await assert.rejects(
    () =>
      resolveDeploymentTarget(
        { ...registry, findProject: async () => null },
        {
          tenantId: "tenant-acme",
          owner: "acme",
          repository: "checkout",
          workflow: "deploy.yml",
          ref: "refs/heads/main",
          audience: expectedAudience,
        }
      ),
    (error: unknown) => error instanceof DeploymentResolutionError && error.code === "UNCONFIGURED"
  );
});

test("deployment handler resolves a real token with fixture mode disabled", async () => {
  const originalOrgMap = process.env.GITHUB_ORG_MAP;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ "tenant-acme": "acme" });
  try {
    const resolutions: string[] = [];
    const response = await resolveDeploymentRoute(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        headers: { authorization: `Bearer ${token()}` },
      }),
      {
        verifyToken: (value, audience) => verifyGitHubActionsOidcToken(value, audience, fetchJwks()),
        findTenant: async () => "tenant-acme",
        storeForTenant: () =>
          ({
            deploymentRegistry: () => ({
              findRepository: async () => ({
                tenantId: "tenant-acme",
                owner: "acme",
                repository: "checkout",
                workflow: "deploy.yml",
                ref: "refs/heads/main",
              }),
              findProject: async () => ({ projectId: "prj_acme", teamId: "team_acme" }),
            }),
            recordDeploymentResolution: async (_subject: string, _kind: string, outcome: string) => {
              resolutions.push(outcome);
            },
          }) as never,
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projectId: "prj_acme", teamId: "team_acme" });
    assert.deepEqual(resolutions, ["allowed"]);

    process.env.GITHUB_ORG_MAP = JSON.stringify({ "tenant-acme": "other-org" });
    const denied = await resolveDeploymentRoute(
      new Request("http://localhost/api/hosted/deployments/resolve", {
        headers: { authorization: `Bearer ${token()}` },
      }),
      {
        verifyToken: (value, audience) => verifyGitHubActionsOidcToken(value, audience, fetchJwks()),
        findTenant: async () => "tenant-acme",
        storeForTenant: () =>
          ({
            deploymentRegistry: () => ({
              findRepository: async () => null,
              findProject: async () => ({ projectId: "prj_acme" }),
            }),
            recordDeploymentResolution: async () => undefined,
          }) as never,
      }
    );
    assert.equal(denied.status, 403);
  } finally {
    if (originalOrgMap === undefined) delete process.env.GITHUB_ORG_MAP;
    else process.env.GITHUB_ORG_MAP = originalOrgMap;
  }
});