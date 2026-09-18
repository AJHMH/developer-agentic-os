import { NextResponse } from "next/server";
import {
  hostedError,
  hostedIdentity,
  hostedInfrastructureError,
} from "@/app/api/hosted/_shared";
import {
  DeploymentResolutionError,
  resolveDeploymentTarget,
} from "@/server/hosted-deployments/deployment-resolution";
import { verifyGitHubActionsOidcToken } from "@/server/hosted-deployments/github-actions-oidc";
import { requiredGitHubOrgForTenant } from "@/server/hosted-auth/github-link";
import { findHostedTenantForGitHubRepository } from "@/server/hosted-persistence/neon-hosted-provider";
import { hostedDomainStoreForTenant } from "@/server/hosted-domain/hosted-domain-store";

export type GitHubActionsDeploymentDependencies = {
  verifyToken?: typeof verifyGitHubActionsOidcToken;
  findTenant?: typeof findHostedTenantForGitHubRepository;
  storeForTenant?: typeof hostedDomainStoreForTenant;
};

type DeploymentResolutionClaims = {
  owner: string;
  repository: string;
  workflow: string;
  ref: string;
  audience: string;
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
    return NextResponse.json({
      project,
      repositories: await identity.domainStore.listGitHubRepositories(identity.userId, workspaceId),
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
    return NextResponse.json({ error: "Unknown deployment action." }, { status: 400 });
  } catch (error) {
    return hostedError(error);
  }
}

async function resolveGitHubActionsClaims(
  request: Request,
  verifyToken: typeof verifyGitHubActionsOidcToken,
  requestBody?: Record<string, unknown>
): Promise<DeploymentResolutionClaims | null> {
  if (
    requestBody &&
    (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
    process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
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
  try {
    const verified = await verifyToken(authorization[1], "developer-agentic-os");
    return {
      owner: verified.repositoryOwner,
      repository: verified.repository.split("/").at(-1) ?? "",
      workflow: verified.workflow,
      ref: verified.ref,
      audience: verified.audience,
    };
  } catch (error) {
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
  const verifyToken = dependencies.verifyToken ?? verifyGitHubActionsOidcToken;
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
    claims = await resolveGitHubActionsClaims(request, verifyToken, requestBody);
    if (!claims)
      return NextResponse.json(
        { error: "A GitHub Actions OIDC token is required." },
        { status: 401 }
      );
    tenantId =
      fixtureTenantId && fixtureTenantId.trim()
        ? fixtureTenantId
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
    await domainStore.recordDeploymentResolution(
      `github-actions:${claims.owner}/${claims.repository}`,
    "allowed",
    `${claims.owner}/${claims.repository}`,
    target,
    auditWorkspaceId
    );
    return NextResponse.json(target);
  } catch (error) {
    if (tenantId && claims) {
    try {
      await storeForTenant(tenantId).recordDeploymentResolution(
        `github-actions:${claims.owner}/${claims.repository}`,
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
