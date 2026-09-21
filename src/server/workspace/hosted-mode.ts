import { NextResponse } from "next/server";
import { hostedIdentity } from "@/app/api/hosted/_shared";
import type { HostedWorkspace } from "@/types/hosted-workspace";
import type { RepositoryContext } from "@/types/workspace";

/**
 * Determines whether the current execution context is in hosted mode (Vercel deployment
 * or hosted test fixture with x-hosted-user-id headers).
 */
export function isHostedMode(request?: Request): boolean {
  if (process.env.VERCEL === "1") return true;
  if (process.env.DEV_AGENTIC_OS_HOSTED_MODE === "true") return true;
  if (request?.headers.get("x-hosted-user-id")) return true;
  if (request?.headers.get("authorization")?.startsWith("Bearer ")) return true;
  return false;
}

/**
 * Resolves the authenticated hosted context including active workspace and repository context.
 * Returns a NextResponse if authentication fails or an infrastructure error occurs.
 */
export async function resolveHostedWorkspaceContext(
  request: Request,
  workspaceIdOverride?: string | null
): Promise<
  | {
      userId: string;
      tenantId: string;
      displayName: string;
      activeWorkspace: HostedWorkspace;
      memberRole?: import("@/types/hosted-workspace").WorkspaceRole;
      repositoryContext: RepositoryContext;
      workspaceStore: ReturnType<
        typeof import("@/server/hosted-workspaces/hosted-workspace-store").hostedWorkspaceStoreForTenant
      >;
      domainStore: ReturnType<
        typeof import("@/server/hosted-domain/hosted-domain-store").hostedDomainStoreForTenant
      >;
    }
  | NextResponse
> {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;

  const workspaceStore = identity.workspaceStore;
  await workspaceStore.ensureDefault(identity.userId);

  let activeWorkspace: HostedWorkspace | null = null;
  if (workspaceIdOverride) {
    const list = await workspaceStore.list(identity.userId);
    activeWorkspace = list.find((ws) => ws.id === workspaceIdOverride) ?? null;
    if (!activeWorkspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }
  }
  if (!activeWorkspace) {
    activeWorkspace = await workspaceStore.active(identity.userId);
  }
  if (!activeWorkspace) {
    const list = await workspaceStore.list(identity.userId);
    activeWorkspace = list[0] ?? (await workspaceStore.create(identity.userId, "Workspace 1"));
  }

  const memberRole = (await workspaceStore.getRole(identity.userId, activeWorkspace.id)) ?? "owner";

  const repositoryContext: RepositoryContext = {
    id: activeWorkspace.id,
    name: activeWorkspace.name,
    path: `/workspaces/${activeWorkspace.name}`,
  };

  return {
    ...identity,
    activeWorkspace,
    memberRole,
    repositoryContext,
    workspaceStore,
    domainStore: identity.domainStore,
  };
}
