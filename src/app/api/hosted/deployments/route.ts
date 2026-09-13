import { NextResponse } from "next/server";
import { hostedError, hostedIdentity } from "@/app/api/hosted/_shared";
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
  if (!action || (!workspaceId && action !== "resolve"))
    return NextResponse.json({ error: "workspaceId and action are required." }, { status: 400 });
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
    if (action === "resolve") {
      const authorization = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
      const claims: {
        owner: string;
        repository: string;
        workflow: string;
        ref: string;
        audience: string;
      } | null =
        (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
        process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
          ? {
              owner: String(body.owner ?? ""),
              repository: String(body.repository ?? ""),
              workflow: String(body.workflow ?? ""),
              ref: String(body.ref ?? ""),
              audience: String(body.audience ?? ""),
            }
          : authorization
            ? await verifyGitHubActionsOidcToken(authorization[1], "developer-agentic-os")
                .then((verified) => ({
                  owner: verified.repositoryOwner,
                  repository: verified.repository.split("/").at(-1) ?? "",
                  workflow: verified.workflow,
                  ref: verified.ref,
                  audience: verified.audience,
                }))
                .catch(() => {
                  throw new DeploymentResolutionError(
                    "FORBIDDEN",
                    "Deployment identity is not allowed."
                  );
                })
            : null;
      if (!claims)
        return NextResponse.json(
          { error: "A GitHub Actions OIDC token is required." },
          { status: 401 }
        );
      const configuredOrg = requiredGitHubOrgForTenant(identity.tenantId);
      if (!configuredOrg || configuredOrg.toLowerCase() !== claims.owner.toLowerCase())
        throw new DeploymentResolutionError(
          "FORBIDDEN",
          "Deployment repository is not allowed for this Tenant."
        );
      const target = await resolveDeploymentTarget(identity.domainStore.deploymentRegistry(), {
        tenantId: identity.tenantId,
        owner: claims.owner,
        repository: claims.repository,
        workflow: claims.workflow,
        ref: claims.ref,
        audience: claims.audience,
      });
      await identity.domainStore.recordDeploymentResolution(
        identity.userId,
        workspaceId,
        "allowed",
        `${claims.owner}/${claims.repository}`,
        target
      );
      return NextResponse.json(target);
    }
    return NextResponse.json({ error: "Unknown deployment action." }, { status: 400 });
  } catch (error) {
    if (error instanceof DeploymentResolutionError) {
      await identity.domainStore.recordDeploymentResolution(identity.userId, workspaceId, "denied");
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "UNCONFIGURED" ? 409 : error.code === "NOT_FOUND" ? 404 : 403 }
      );
    }
    return hostedError(error);
  }
}

export async function resolveGitHubActionsDeployment(
  request: Request,
  dependencies: GitHubActionsDeploymentDependencies = {}
): Promise<NextResponse> {
  const verifyToken = dependencies.verifyToken ?? verifyGitHubActionsOidcToken;
  const findTenant = dependencies.findTenant ?? findHostedTenantForGitHubRepository;
  const storeForTenant = dependencies.storeForTenant ?? hostedDomainStoreForTenant;
  const authorization = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!authorization)
    return NextResponse.json(
      { error: "A GitHub Actions OIDC token is required." },
      { status: 401 }
    );
  let tenantId: string | null = null;
  let owner = "";
  let repository = "";
  try {
    const verified = await verifyToken(authorization[1], "developer-agentic-os");
    owner = verified.repositoryOwner;
    repository = verified.repository.split("/").at(-1) ?? "";
    tenantId = await findTenant(owner, repository);
    if (!tenantId)
      return NextResponse.json(
        { error: "Repository registration was not found." },
        { status: 404 }
      );
    const configuredOrg = requiredGitHubOrgForTenant(tenantId);
    if (!configuredOrg || configuredOrg.toLowerCase() !== owner.toLowerCase())
      throw new DeploymentResolutionError(
        "FORBIDDEN",
        "Deployment repository is not allowed for this Tenant."
      );
    const domainStore = storeForTenant(tenantId);
    const target = await resolveDeploymentTarget(domainStore.deploymentRegistry(), {
      tenantId,
      owner,
      repository,
      workflow: verified.workflow,
      ref: verified.ref,
      audience: verified.audience,
    });
    await domainStore.recordDeploymentResolution(
      `github-actions:${owner}/${repository}`,
      "deployment",
      "allowed",
      `${owner}/${repository}`
    );
    return NextResponse.json(target);
  } catch (error) {
    if (tenantId) {
      await storeForTenant(tenantId).recordDeploymentResolution(
        `github-actions:${owner}/${repository}`,
        "deployment",
        "denied",
        `${owner}/${repository}`
      );
    }
    if (error instanceof DeploymentResolutionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "UNCONFIGURED" ? 409 : error.code === "NOT_FOUND" ? 404 : 403 }
      );
    return NextResponse.json({ error: "Deployment identity is not allowed." }, { status: 401 });
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
