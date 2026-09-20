import { NextResponse } from "next/server";
import { hostedError, hostedIdentity, hostedInfrastructureError } from "@/app/api/hosted/_shared";
import {
  DeploymentResolutionError,
  resolveDeploymentTarget,
} from "@/server/hosted-deployments/deployment-resolution";
import { verifyGitHubActionsOidcToken } from "@/server/hosted-deployments/github-actions-oidc";
import { requiredGitHubOrgForTenant } from "@/server/hosted-auth/github-link";
import { findHostedTenantForGitHubRepository } from "@/server/hosted-persistence/neon-hosted-provider";
import { hostedDomainStoreForTenant } from "@/server/hosted-domain/hosted-domain-store";
import {
  type DeploymentFallbackCredentialManager,
  fallbackCredentialManager,
} from "@/server/hosted-deployments/fallback-credentials";

export type GitHubActionsDeploymentDependencies = {
  verifyToken?: typeof verifyGitHubActionsOidcToken;
  findTenant?: typeof findHostedTenantForGitHubRepository;
  storeForTenant?: typeof hostedDomainStoreForTenant;
  fallbackCredentialManager?: DeploymentFallbackCredentialManager;
};

type DeploymentResolutionClaims = {
  owner: string;
  repository: string;
  workflow: string;
  ref: string;
  audience: string;
  fallbackCredentialId?: string;
};

function isVerificationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /^OIDC .+ claim is required\.$/.test(error.message) ||
    /^GitHub Actions OIDC (token is invalid|token algorithm is not allowed|issuer is not allowed|audience is not allowed|token has expired|signing key was not found|signature is invalid|workflow claim is invalid)\.$/.test(
      error.message
    ) ||
    /^GitHub Actions (repository claims do not match|workflow repository claim does not match)\.$/.test(
      error.message
    )
  );
}

function adminRequired(identity: { orgRole?: string }): NextResponse | null {
  return identity.orgRole === "org:admin"
    ? null
    : NextResponse.json(
        { error: "Organization administrator access is required." },
        { status: 403 }
      );
}

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId)
    return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  try {
    const denied = adminRequired(identity);
    if (denied) return denied;
    const project = await identity.domainStore.getVercelProject(identity.userId, workspaceId);
    const repositories = await identity.domainStore.listGitHubRepositories(
      identity.userId,
      workspaceId
    );
    const includeFallback = new URL(request.url).searchParams.get("fallback") === "true";
    return NextResponse.json({
      project,
      repositories,
      ...(includeFallback
        ? { fallbackCredentials: fallbackCredentialManager.list(identity.tenantId) }
        : {}),
    });
  } catch (error) {
    return hostedError(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const supportedActions = new Set([
    "set-project",
    "set-webhook-secret",
    "register-repository",
    "resolve",
    "create-fallback-credential",
    "rotate-fallback-credential",
    "revoke-fallback-credential",
    "list-fallback-credentials",
  ]);
  if (!action)
    return NextResponse.json({ error: "workspaceId and action are required." }, { status: 400 });
  if (!supportedActions.has(action))
    return NextResponse.json({ error: "Unknown deployment action." }, { status: 400 });
  if (!workspaceId && action !== "resolve")
    return NextResponse.json({ error: "workspaceId and action are required." }, { status: 400 });
  if (action === "resolve") return resolveGitHubActionsDeployment(request, {}, body);
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  try {
    if (action === "set-project") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      if (typeof body.projectId !== "string")
        return NextResponse.json({ error: "projectId is required." }, { status: 400 });
      if (typeof body.webhookSecret !== "string" || !body.webhookSecret.trim())
        return NextResponse.json({ error: "webhookSecret is required." }, { status: 400 });
      const project = await identity.domainStore.setVercelProject(
        identity.userId,
        workspaceId,
        {
          projectId: body.projectId,
          teamId: typeof body.teamId === "string" ? body.teamId : undefined,
        },
        body.webhookSecret
      );
      return NextResponse.json({ project });
    }
    if (action === "set-webhook-secret") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      if (typeof body.secret !== "string")
        return NextResponse.json({ error: "secret is required." }, { status: 400 });
      await identity.domainStore.setVercelWebhookSecret(identity.userId, workspaceId, body.secret);
      return NextResponse.json({ ok: true });
    }
    if (action === "register-repository") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      const owner = typeof body.owner === "string" ? body.owner : "";
      const repository = typeof body.repository === "string" ? body.repository : "";
      if (!owner.trim() || !repository.trim())
        return NextResponse.json({ error: "owner and repository are required." }, { status: 400 });
      const configuredOrg = requiredGitHubOrgForTenant(identity.tenantId);
      if (!configuredOrg || owner.toLowerCase() !== configuredOrg.toLowerCase())
        return NextResponse.json(
          { error: "Repository owner must match the Tenant's configured GitHub organization." },
          { status: 403 }
        );
      if (typeof body.workflow !== "string" || typeof body.ref !== "string")
        return NextResponse.json({ error: "workflow and ref are required." }, { status: 400 });
      return NextResponse.json(
        {
          repository: await identity.domainStore.registerGitHubRepository(
            identity.userId,
            workspaceId,
            { owner, repository, workflow: body.workflow, ref: body.ref }
          ),
        },
        { status: 201 }
      );
    }
    if (action === "create-fallback-credential") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      const owner = typeof body.owner === "string" ? body.owner.trim() : "";
      const repository = typeof body.repository === "string" ? body.repository.trim() : "";
      const removalDeadline =
        typeof body.removalDeadline === "string" ? body.removalDeadline.trim() : "";
      const description =
        typeof body.description === "string" ? body.description.trim() : undefined;
      const rawSecret = typeof body.rawSecret === "string" ? body.rawSecret.trim() : undefined;

      if (!owner || !repository)
        return NextResponse.json({ error: "owner and repository are required." }, { status: 400 });
      if (!removalDeadline)
        return NextResponse.json({ error: "removalDeadline is required." }, { status: 400 });

      const configuredOrg = requiredGitHubOrgForTenant(identity.tenantId);
      if (!configuredOrg || owner.toLowerCase() !== configuredOrg.toLowerCase())
        return NextResponse.json(
          { error: "Repository owner must match the Tenant's configured GitHub organization." },
          { status: 403 }
        );

      const created = await fallbackCredentialManager.create({
        tenantId: identity.tenantId,
        owner,
        repository,
        removalDeadline,
        description,
        rawSecret,
      });

      await identity.domainStore.recordFallbackCredentialEvent({
        userId: identity.userId,
        workspaceId,
        action: "deployment.fallback_credential.created",
        credentialId: created.credential.id,
        repositoryId: `${owner}/${repository}`,
        outcome: "allowed",
      });

      return NextResponse.json(created, { status: 201 });
    }
    if (action === "rotate-fallback-credential") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      const credentialId =
        typeof body.credentialId === "string"
          ? body.credentialId.trim()
          : typeof body.id === "string"
            ? body.id.trim()
            : "";
      if (!credentialId)
        return NextResponse.json({ error: "credentialId is required." }, { status: 400 });

      const existing = fallbackCredentialManager.get(credentialId);
      if (!existing || existing.tenantId !== identity.tenantId)
        return NextResponse.json({ error: "Fallback credential not found." }, { status: 404 });

      const newRawSecret =
        typeof body.newRawSecret === "string" ? body.newRawSecret.trim() : undefined;
      const newRemovalDeadline =
        typeof body.newRemovalDeadline === "string" ? body.newRemovalDeadline.trim() : undefined;

      const rotated = await fallbackCredentialManager.rotate(
        credentialId,
        newRawSecret,
        newRemovalDeadline
      );

      await identity.domainStore.recordFallbackCredentialEvent({
        userId: identity.userId,
        workspaceId,
        action: "deployment.fallback_credential.rotated",
        credentialId: rotated.credential.id,
        repositoryId: `${rotated.credential.owner}/${rotated.credential.repository}`,
        outcome: "allowed",
      });

      return NextResponse.json(rotated);
    }
    if (action === "revoke-fallback-credential") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      const credentialId =
        typeof body.credentialId === "string"
          ? body.credentialId.trim()
          : typeof body.id === "string"
            ? body.id.trim()
            : "";
      if (!credentialId)
        return NextResponse.json({ error: "credentialId is required." }, { status: 400 });

      const existing = fallbackCredentialManager.get(credentialId);
      if (!existing || existing.tenantId !== identity.tenantId)
        return NextResponse.json({ error: "Fallback credential not found." }, { status: 404 });

      const revoked = fallbackCredentialManager.revoke(credentialId);

      await identity.domainStore.recordFallbackCredentialEvent({
        userId: identity.userId,
        workspaceId,
        action: "deployment.fallback_credential.revoked",
        credentialId: revoked.id,
        repositoryId: `${revoked.owner}/${revoked.repository}`,
        outcome: "allowed",
      });

      return NextResponse.json({ credential: revoked });
    }
    if (action === "list-fallback-credentials") {
      const denied = adminRequired(identity);
      if (denied) return denied;
      return NextResponse.json({
        credentials: fallbackCredentialManager.list(identity.tenantId),
      });
    }
    return NextResponse.json({ error: "Unknown deployment action." }, { status: 400 });
  } catch (error) {
    return hostedError(error);
  }
}

async function resolveGitHubActionsClaims(
  request: Request,
  dependencies: GitHubActionsDeploymentDependencies = {},
  requestBody?: Record<string, unknown>
): Promise<DeploymentResolutionClaims | null> {
  const verifyToken = dependencies.verifyToken ?? verifyGitHubActionsOidcToken;
  const credentialManager = dependencies.fallbackCredentialManager ?? fallbackCredentialManager;
  const storeForTenant = dependencies.storeForTenant ?? hostedDomainStoreForTenant;

  if (
    requestBody &&
    (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
    process.env.HOSTED_AUTH_FIXTURE_MODE === "true" &&
    !request.headers.get("authorization")
  ) {
    return {
      owner: String(requestBody.owner ?? ""),
      repository: String(requestBody.repository ?? ""),
      workflow: String(requestBody.workflow ?? ""),
      ref: String(requestBody.ref ?? ""),
      audience: String(requestBody.audience ?? ""),
    };
  }
  const authorization = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!authorization) return null;
  const token = authorization[1];

  try {
    const verified = await verifyToken(token, "developer-agentic-os");
    return {
      owner: verified.repositoryOwner,
      repository: verified.repository.split("/").at(-1) ?? "",
      workflow: verified.workflow,
      ref: verified.ref,
      audience: verified.audience,
    };
  } catch (error) {
    // If OIDC token verification failed, check for temporary fallback credential
    const expectedOwner = typeof requestBody?.owner === "string" ? requestBody.owner : undefined;
    const expectedRepo =
      typeof requestBody?.repository === "string" ? requestBody.repository : undefined;
    const fallbackResult = credentialManager.verify(token, {
      owner: expectedOwner,
      repository: expectedRepo,
    });

    if (fallbackResult.valid) {
      return {
        owner: fallbackResult.credential.owner,
        repository: fallbackResult.credential.repository,
        workflow:
          typeof requestBody?.workflow === "string"
            ? requestBody.workflow
            : ".github/workflows/deploy.yml",
        ref: typeof requestBody?.ref === "string" ? requestBody.ref : "refs/heads/main",
        audience: "developer-agentic-os",
        fallbackCredentialId: fallbackResult.credential.id,
      };
    }

    if (fallbackResult.code === "EXPIRED") {
      if (fallbackResult.credential) {
        try {
          await storeForTenant(fallbackResult.credential.tenantId).recordFallbackCredentialEvent({
            userId: `fallback-credential:${fallbackResult.credential.id}`,
            action: "deployment.fallback_credential.expired",
            credentialId: fallbackResult.credential.id,
            repositoryId: `${fallbackResult.credential.owner}/${fallbackResult.credential.repository}`,
            outcome: "denied",
          });
        } catch {
          // Ignore best-effort denial audit failures.
        }
      }
      throw new DeploymentResolutionError("FORBIDDEN", fallbackResult.reason);
    }

    if (fallbackResult.code === "REVOKED" || fallbackResult.code === "SCOPE_MISMATCH") {
      if (fallbackResult.credential) {
        try {
          await storeForTenant(fallbackResult.credential.tenantId).recordFallbackCredentialEvent({
            userId: `fallback-credential:${fallbackResult.credential.id}`,
            action: "deployment.fallback_credential.rejected",
            credentialId: fallbackResult.credential.id,
            repositoryId: `${fallbackResult.credential.owner}/${fallbackResult.credential.repository}`,
            outcome: "denied",
          });
        } catch {
          // Ignore best-effort denial audit failures.
        }
      }
      throw new DeploymentResolutionError("FORBIDDEN", fallbackResult.reason);
    }

    if (isVerificationFailure(error))
      throw new DeploymentResolutionError("FORBIDDEN", "Deployment identity is not allowed.");
    throw new Error("Deployment identity verification is temporarily unavailable.", {
      cause: error,
    });
  }
}

export async function resolveGitHubActionsDeployment(
  request: Request,
  dependencies: GitHubActionsDeploymentDependencies = {},
  requestBody?: Record<string, unknown>
): Promise<NextResponse> {
  const findTenant = dependencies.findTenant ?? findHostedTenantForGitHubRepository;
  const storeForTenant = dependencies.storeForTenant ?? hostedDomainStoreForTenant;
  const fixtureTenantId =
    requestBody &&
    (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
    process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
      ? request.headers.get("x-hosted-tenant-id")
      : null;
  const auditWorkspaceId =
    typeof requestBody?.workspaceId === "string" && requestBody.workspaceId.trim()
      ? requestBody.workspaceId.trim()
      : undefined;
  let claims: DeploymentResolutionClaims | null = null;
  let tenantId: string | null = null;
  try {
    claims = await resolveGitHubActionsClaims(request, dependencies, requestBody);
    if (!claims)
      return NextResponse.json(
        { error: "A GitHub Actions OIDC token is required." },
        { status: 401 }
      );
    tenantId =
      fixtureTenantId && fixtureTenantId.trim()
        ? fixtureTenantId
        : claims.fallbackCredentialId
          ? ((dependencies.fallbackCredentialManager ?? fallbackCredentialManager).get(
              claims.fallbackCredentialId
            )?.tenantId ?? null)
          : await findTenant(claims.owner, claims.repository);
    if (!tenantId)
      return NextResponse.json(
        { error: "Repository registration was not found." },
        { status: 404 }
      );
    const configuredOrg = requiredGitHubOrgForTenant(tenantId);
    if (!configuredOrg || configuredOrg.toLowerCase() !== claims.owner.toLowerCase())
      throw new DeploymentResolutionError(
        "FORBIDDEN",
        "Deployment repository is not allowed for this Tenant."
      );
    const domainStore = storeForTenant(tenantId);
    const target = await resolveDeploymentTarget(domainStore.deploymentRegistry(), {
      tenantId,
      owner: claims.owner,
      repository: claims.repository,
      workflow: claims.workflow,
      ref: claims.ref,
      audience: claims.audience,
    });
    if (claims.fallbackCredentialId) {
      await domainStore.recordFallbackCredentialEvent({
        userId: `fallback-credential:${claims.fallbackCredentialId}`,
        workspaceId: auditWorkspaceId,
        action: "deployment.fallback_credential.used",
        credentialId: claims.fallbackCredentialId,
        repositoryId: `${claims.owner}/${claims.repository}`,
        outcome: "allowed",
      });
    }
    await domainStore.recordDeploymentResolution(
      claims.fallbackCredentialId
        ? `fallback-credential:${claims.fallbackCredentialId}`
        : `github-actions:${claims.owner}/${claims.repository}`,
      "allowed",
      `${claims.owner}/${claims.repository}`,
      target,
      auditWorkspaceId
    );
    return NextResponse.json(target);
  } catch (error) {
    if (tenantId && claims) {
      try {
        if (claims.fallbackCredentialId) {
          await storeForTenant(tenantId).recordFallbackCredentialEvent({
            userId: `fallback-credential:${claims.fallbackCredentialId}`,
            workspaceId: auditWorkspaceId,
            action: "deployment.fallback_credential.rejected",
            credentialId: claims.fallbackCredentialId,
            repositoryId: `${claims.owner}/${claims.repository}`,
            outcome: "denied",
          });
        }
        await storeForTenant(tenantId).recordDeploymentResolution(
          claims.fallbackCredentialId
            ? `fallback-credential:${claims.fallbackCredentialId}`
            : `github-actions:${claims.owner}/${claims.repository}`,
          "denied",
          `${claims.owner}/${claims.repository}`,
          undefined,
          auditWorkspaceId
        );
      } catch {
        // Ignore best-effort denial audit failures.
      }
    }
    if (error instanceof DeploymentResolutionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "UNCONFIGURED" ? 409 : error.code === "NOT_FOUND" ? 404 : 403 }
      );
    if (
      error instanceof Error &&
      error.message === "Deployment identity verification is temporarily unavailable."
    )
      return NextResponse.json(
        { error: "Deployment identity verification is temporarily unavailable." },
        { status: 503 }
      );
    const infrastructure = hostedInfrastructureError(error);
    if (infrastructure) return infrastructure;
    return hostedError(error);
  }
}

export async function DELETE(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const denied = adminRequired(identity);
  if (denied) return denied;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId)
    return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  try {
    await identity.domainStore.removeVercelProject(identity.userId, workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hostedError(error);
  }
}
