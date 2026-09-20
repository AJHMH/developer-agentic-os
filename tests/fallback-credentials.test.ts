import assert from "node:assert/strict";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { GET, POST } from "../src/app/api/hosted/deployments/route";
import { POST as resolveDeployment } from "../src/app/api/hosted/deployments/resolve/route";
import { POST as createWorkspace } from "../src/app/api/hosted/workspaces/route";
import { hostedDomainStoreForTenant } from "../src/server/hosted-domain/hosted-domain-store";
import {
  DeploymentFallbackCredentialManager,
  fallbackCredentialManager,
  isRemovalDeadlinePassed,
} from "../src/server/hosted-deployments/fallback-credentials";
import { EncryptedProtectedSecretStore } from "../src/server/hosted-persistence/neon-hosted-provider";

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

test("isRemovalDeadlinePassed calculates expiration correctly", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(isRemovalDeadlinePassed(past), true);
  assert.equal(isRemovalDeadlinePassed(future), false);
  assert.equal(isRemovalDeadlinePassed("invalid-date"), true);
});

test("DeploymentFallbackCredentialManager handles lifecycle and verification", async () => {
  const manager = new DeploymentFallbackCredentialManager();
  const tenantId = `tenant-${Date.now()}`;
  const owner = "acme";
  const repository = "web";
  const removalDeadline = new Date(Date.now() + 3600_000).toISOString();

  // Creation fails if removal deadline is in the past
  await assert.rejects(
    async () => {
      await manager.create({
        tenantId,
        owner,
        repository,
        removalDeadline: new Date(Date.now() - 1000).toISOString(),
      });
    },
    { message: "removalDeadline must be in the future." }
  );

  // Creation succeeds with future removal deadline
  const created = await manager.create({
    tenantId,
    owner,
    repository,
    removalDeadline,
    description: "Temporary deployment fallback token",
  });

  assert.ok(created.credential.id);
  assert.equal(created.credential.tenantId, tenantId);
  assert.equal(created.credential.owner, owner);
  assert.equal(created.credential.repository, repository);
  assert.equal(created.credential.status, "active");
  assert.equal(created.credential.isRetired, false);
  assert.equal(created.credential.isExpired, false);
  assert.ok(created.rawSecret.startsWith("dep_fallback_"));

  // Verify active credential
  const validResult = manager.verify(created.rawSecret, { tenantId, owner, repository });
  assert.equal(validResult.valid, true);

  // Verify scope mismatch
  const mismatchTenant = manager.verify(created.rawSecret, {
    tenantId: "other-tenant",
    owner,
    repository,
  });
  assert.equal(mismatchTenant.valid, false);
  assert.equal(mismatchTenant.code, "SCOPE_MISMATCH");

  const mismatchRepo = manager.verify(created.rawSecret, {
    tenantId,
    owner,
    repository: "other-repo",
  });
  assert.equal(mismatchRepo.valid, false);
  assert.equal(mismatchRepo.code, "SCOPE_MISMATCH");

  // Rotation
  const newDeadline = new Date(Date.now() + 7200_000).toISOString();
  const rotated = await manager.rotate(created.credential.id, undefined, newDeadline);
  assert.equal(rotated.credential.id, created.credential.id);
  assert.ok(rotated.credential.rotatedAt);
  assert.notEqual(rotated.rawSecret, created.rawSecret);

  // Old secret is now invalid
  const oldSecretResult = manager.verify(created.rawSecret, { tenantId, owner, repository });
  assert.equal(oldSecretResult.valid, false);
  assert.equal(oldSecretResult.code, "NOT_FOUND");

  // New secret is valid
  const newSecretResult = manager.verify(rotated.rawSecret, { tenantId, owner, repository });
  assert.equal(newSecretResult.valid, true);

  // Expiration check when deadline is in the past
  const pastTime = new Date(Date.now() + 10_000_000);
  const expiredResult = manager.verify(
    rotated.rawSecret,
    { tenantId, owner, repository },
    pastTime
  );
  assert.equal(expiredResult.valid, false);
  assert.equal(expiredResult.code, "EXPIRED");
  assert.ok(expiredResult.credential);

  // Revocation
  const revoked = manager.revoke(created.credential.id);
  assert.equal(revoked.status, "retired");
  assert.equal(revoked.isRetired, true);
  assert.ok(revoked.revokedAt);

  const revokedResult = manager.verify(rotated.rawSecret, { tenantId, owner, repository });
  assert.equal(revokedResult.valid, false);
  assert.equal(revokedResult.code, "REVOKED");
  assert.ok(revokedResult.credential);
});

test("DeploymentFallbackCredentialManager works with EncryptedProtectedSecretStore", async () => {
  const originalKey = process.env.DEV_AGENTIC_OS_SECRET_KEY;
  try {
    process.env.DEV_AGENTIC_OS_SECRET_KEY = Buffer.alloc(32, 7).toString("base64url");
    const encryptedStore = new EncryptedProtectedSecretStore();
    const manager = new DeploymentFallbackCredentialManager(encryptedStore);

    const created = await manager.create({
      tenantId: "tenant-enc",
      owner: "acme",
      repository: "core",
      removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
    });

    const verified = manager.verify(created.rawSecret, {
      tenantId: "tenant-enc",
      owner: "acme",
      repository: "core",
    });
    assert.equal(verified.valid, true);
  } finally {
    process.env.DEV_AGENTIC_OS_SECRET_KEY = originalKey;
  }
});

test("API route allows admin to manage fallback credentials and records audit events", async () => {
  fallbackCredentialManager.clear();
  const tenantId = `tenant-api-${Date.now()}`;
  const userId = `admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });

  const domainStore = hostedDomainStoreForTenant(tenantId);
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "Fallback Test Workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  // Member is forbidden
  const memberCreate = await POST(
    request("member", tenantId, "org:member", {
      method: "POST",
      body: JSON.stringify({
        action: "create-fallback-credential",
        workspaceId,
        owner: "acme",
        repository: "backend",
        removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    })
  );
  assert.equal(memberCreate.status, 403);

  // Mismatched GitHub org is forbidden
  const mismatchedOrgCreate = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "create-fallback-credential",
        workspaceId,
        owner: "other-org",
        repository: "backend",
        removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    })
  );
  assert.equal(mismatchedOrgCreate.status, 403);

  // Admin creates fallback credential
  const createResponse = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "create-fallback-credential",
        workspaceId,
        owner: "acme",
        repository: "backend",
        removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
        description: "Migration credential",
      }),
    })
  );
  assert.equal(createResponse.status, 201);
  const createdBody = (await json(createResponse)) as {
    credential: { id: string; status: string; removalDeadline: string };
    rawSecret: string;
  };
  assert.ok(createdBody.credential.id);
  assert.equal(createdBody.credential.status, "active");
  assert.ok(createdBody.rawSecret);

  // Check audit for created
  const auditList = await domainStore.audit(userId, workspaceId);
  const createdAudit = auditList.find((e) => e.action === "deployment.fallback_credential.created");
  assert.ok(createdAudit);
  assert.equal(createdAudit.subjectId, createdBody.credential.id);
  assert.equal(createdAudit.repositoryId, "acme/backend");
  assert.equal(createdAudit.outcome, "allowed");

  // Admin rotates fallback credential
  const rotateResponse = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "rotate-fallback-credential",
        workspaceId,
        credentialId: createdBody.credential.id,
        newRemovalDeadline: new Date(Date.now() + 7200_000).toISOString(),
      }),
    })
  );
  assert.equal(rotateResponse.status, 200);
  const rotatedBody = (await json(rotateResponse)) as {
    credential: { id: string; rotatedAt: string };
    rawSecret: string;
  };
  assert.ok(rotatedBody.credential.rotatedAt);
  assert.notEqual(rotatedBody.rawSecret, createdBody.rawSecret);

  // Check audit for rotated
  const auditListAfterRotate = await domainStore.audit(userId, workspaceId);
  const rotatedAudit = auditListAfterRotate.find(
    (e) => e.action === "deployment.fallback_credential.rotated"
  );
  assert.ok(rotatedAudit);
  assert.equal(rotatedAudit.subjectId, createdBody.credential.id);

  // List fallback credentials
  const listResponse = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "list-fallback-credentials",
        workspaceId,
      }),
    })
  );
  assert.equal(listResponse.status, 200);
  const listBody = (await json(listResponse)) as { credentials: Array<{ id: string }> };
  assert.equal(listBody.credentials.length, 1);
  assert.equal(listBody.credentials[0]?.id, createdBody.credential.id);

  // GET route also returns fallback credentials when fallback=true
  const getUrl = new Request(
    `http://localhost/api/hosted/deployments?workspaceId=${workspaceId}&fallback=true`,
    {
      headers: {
        "x-hosted-user-id": userId,
        "x-hosted-tenant-id": tenantId,
        "x-hosted-org-role": "org:admin",
      },
    }
  );
  const getWithQuery = await GET(getUrl);
  assert.equal(getWithQuery.status, 200);
  const getBody = (await json(getWithQuery)) as {
    fallbackCredentials: Array<{ id: string }>;
  };
  assert.equal(getBody.fallbackCredentials.length, 1);
  assert.equal(getBody.fallbackCredentials[0]?.id, createdBody.credential.id);

  // Admin revokes fallback credential
  const revokeResponse = await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "revoke-fallback-credential",
        workspaceId,
        credentialId: createdBody.credential.id,
      }),
    })
  );
  assert.equal(revokeResponse.status, 200);
  const revokedBody = (await json(revokeResponse)) as {
    credential: { id: string; status: string; isRetired: boolean };
  };
  assert.equal(revokedBody.credential.status, "retired");
  assert.equal(revokedBody.credential.isRetired, true);

  // Check audit for revoked
  const auditListAfterRevoke = await domainStore.audit(userId, workspaceId);
  const revokedAudit = auditListAfterRevoke.find(
    (e) => e.action === "deployment.fallback_credential.revoked"
  );
  assert.ok(revokedAudit);
  assert.equal(revokedAudit.subjectId, createdBody.credential.id);
});

test("deployment resolution succeeds with valid fallback credential and fails closed on expired/revoked/mismatched credentials", async () => {
  fallbackCredentialManager.clear();
  const tenantId = `tenant-resolve-${Date.now()}`;
  const userId = `resolve-admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });

  const domainStore = hostedDomainStoreForTenant(tenantId);
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "Resolve Test Workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  // Set project mapping
  await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_fallback_test",
        teamId: "team_fallback_test",
        webhookSecret: "secret-123",
      }),
    })
  );

  // Register repository
  await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        owner: "acme",
        repository: "api-service",
        workflow: ".github/workflows/deploy.yml",
        ref: "refs/heads/main",
      }),
    })
  );

  // Create active fallback credential
  const { credential, rawSecret } = await fallbackCredentialManager.create({
    tenantId,
    owner: "acme",
    repository: "api-service",
    removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
    description: "Test fallback token",
  });

  // Resolve with valid fallback credential token via Authorization header
  const resolveWithValid = await resolveDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId,
        owner: "acme",
        repository: "api-service",
      }),
    })
  );
  assert.equal(resolveWithValid.status, 200);
  const targetBody = (await json(resolveWithValid)) as { projectId: string; teamId?: string };
  assert.equal(targetBody.projectId, "prj_fallback_test");
  assert.equal(targetBody.teamId, "team_fallback_test");

  // Verify audit event: deployment.fallback_credential.used
  const auditRecords = await readAudit(domainStore);
  const usedAudit = auditRecords.find((e) => e.action === "deployment.fallback_credential.used");
  assert.ok(usedAudit);
  assert.equal(usedAudit.subjectId, credential.id);
  assert.equal(usedAudit.outcome, "allowed");

  // Scope mismatch: repository does not match credential
  const resolveMismatch = await resolveDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId,
        owner: "acme",
        repository: "other-service",
      }),
    })
  );
  assert.equal(resolveMismatch.status, 403);
  const mismatchBody = await json(resolveMismatch);
  assert.equal(mismatchBody.error, "Fallback credential repository name does not match.");

  // Check audit for rejected scope mismatch
  const mismatchAudit = (await readAudit(domainStore)).find(
    (e) => e.action === "deployment.fallback_credential.rejected" && e.subjectId === credential.id
  );
  assert.ok(mismatchAudit);
  assert.equal(mismatchAudit.outcome, "denied");

  // Expired fallback credential: create one whose removal deadline is expired
  const expiredCred = await fallbackCredentialManager.create({
    tenantId,
    owner: "acme",
    repository: "api-service",
    removalDeadline: new Date(Date.now() + 10).toISOString(),
  });
  // Force removal deadline to the past
  (expiredCred.credential as unknown as { removalDeadline: string }).removalDeadline = new Date(
    Date.now() - 10_000
  ).toISOString();
  // Update internal map record
  const internalExpired = (
    fallbackCredentialManager as unknown as {
      credentials: Map<string, { removalDeadline: string }>;
    }
  ).credentials.get(expiredCred.credential.id);
  if (internalExpired) {
    internalExpired.removalDeadline = new Date(Date.now() - 10_000).toISOString();
  }

  const resolveExpired = await resolveDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${expiredCred.rawSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId,
        owner: "acme",
        repository: "api-service",
      }),
    })
  );
  assert.equal(resolveExpired.status, 403);
  const expiredBody = await json(resolveExpired);
  assert.match(String(expiredBody.error), /Fallback credential expired at removal deadline/);

  // Check audit for expired
  const expiredAudit = (await readAudit(domainStore)).find(
    (e) =>
      e.action === "deployment.fallback_credential.expired" &&
      e.subjectId === expiredCred.credential.id
  );
  assert.ok(expiredAudit);
  assert.equal(expiredAudit.outcome, "denied");

  // Revoke active credential and verify it fails closed
  fallbackCredentialManager.revoke(credential.id);
  const resolveRevoked = await resolveDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId,
        owner: "acme",
        repository: "api-service",
      }),
    })
  );
  assert.equal(resolveRevoked.status, 403);
  const revokedBody = await json(resolveRevoked);
  assert.equal(revokedBody.error, "Fallback credential has been revoked.");
});

test("steady-state OIDC resolution succeeds without using fallback credentials", async () => {
  fallbackCredentialManager.clear();
  const tenantId = `tenant-oidc-${Date.now()}`;
  const userId = `oidc-admin-${Date.now()}`;
  process.env.GITHUB_ORG_MAP = JSON.stringify({ [tenantId]: "acme" });

  const domainStore = hostedDomainStoreForTenant(tenantId);
  const workspaceResponse = await createWorkspace(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({ name: "OIDC Workspace" }),
    })
  );
  const workspaceId = ((await json(workspaceResponse)).workspace as { id: string }).id;

  // Set project mapping
  await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "set-project",
        workspaceId,
        projectId: "prj_oidc_steady",
        teamId: "team_oidc_steady",
        webhookSecret: "oidc-webhook-secret",
      }),
    })
  );

  // Register repository
  await POST(
    request(userId, tenantId, "org:admin", {
      method: "POST",
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        owner: "acme",
        repository: "frontend",
        workflow: "deploy.yml",
        ref: "refs/heads/main",
      }),
    })
  );

  // Even if a fallback credential exists for this repo...
  await fallbackCredentialManager.create({
    tenantId,
    owner: "acme",
    repository: "frontend",
    removalDeadline: new Date(Date.now() + 3600_000).toISOString(),
  });

  // A valid OIDC token uses steady-state OIDC path directly
  const mockVerifyToken = async () => ({
    audience: "developer-agentic-os",
    repository: "acme/frontend",
    repositoryOwner: "acme",
    workflow: "deploy.yml",
    ref: "refs/heads/main",
  });

  const { resolveGitHubActionsDeployment } =
    await import("../src/app/api/hosted/deployments/route");
  const directResponse = await resolveGitHubActionsDeployment(
    new Request("http://localhost/api/hosted/deployments/resolve", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-github-actions-oidc-jwt",
        "content-type": "application/json",
        "x-hosted-tenant-id": tenantId,
      },
    }),
    {
      verifyToken:
        mockVerifyToken as unknown as typeof import("../src/server/hosted-deployments/github-actions-oidc").verifyGitHubActionsOidcToken,
    },
    { workspaceId }
  );

  assert.equal(directResponse.status, 200);
  const target = (await json(directResponse)) as { projectId: string; teamId?: string };
  assert.equal(target.projectId, "prj_oidc_steady");
  assert.equal(target.teamId, "team_oidc_steady");

  // Verify that resolution was audited under github-actions, NOT fallback-credential
  const auditRecords = await readAudit(domainStore);
  const oidcResolutionAudit = auditRecords.find(
    (e) => e.action === "deployment.resolution" && e.userId === "github-actions:acme/frontend"
  );
  assert.ok(oidcResolutionAudit);
  assert.equal(oidcResolutionAudit.outcome, "allowed");

  const fallbackUsedAudit = auditRecords.find(
    (e) => e.action === "deployment.fallback_credential.used"
  );
  assert.equal(fallbackUsedAudit, undefined);
});
