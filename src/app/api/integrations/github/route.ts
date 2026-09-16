import { NextResponse } from "next/server";

import { hostedIdentity } from "@/app/api/hosted/_shared";
import { GitHubAdapter } from "@/server/integrations/github-adapter";
import {
  githubOrgVerificationMessage,
  requiredGitHubOrgForTenant,
  verifyGitHubOrgMembership,
} from "@/server/hosted-auth/github-link";
import { recordIntegrationFailure } from "@/server/incoming-signals/integration-failure";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request = new Request("http://localhost")) {
  try {
    const requiresHostedEntitlement =
      Boolean(process.env.CLERK_SECRET_KEY) ||
      request.headers.has("x-hosted-user-id") ||
      request.headers.has("authorization");
    if (requiresHostedEntitlement) {
      const identity = await hostedIdentity(request);
      if (identity instanceof NextResponse) return identity;
      const requiredOrg = requiredGitHubOrgForTenant(identity.tenantId);
      if (requiredOrg) {
        const membership = await verifyGitHubOrgMembership(identity.userId, requiredOrg);
        if (!membership.verified) {
          return NextResponse.json(
            {
              error: githubOrgVerificationMessage(requiredOrg, membership.reason),
              requiredOrg,
              orgVerified: false,
              orgVerificationReason: membership.reason,
            },
            { status: 403 }
          );
        }
      }
    }
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    const operations = await new GitHubAdapter(process.env, fetch, context.path).getOperations();
    if (operations.status === "unhealthy" && operations.failure) {
      await recordIntegrationFailure(
        context.path,
        {
          provider: "github",
          sourceId: `github:${operations.repository ?? context.id}:${operations.failure.kind}`,
          title: `GitHub integration unhealthy: ${operations.failure.kind}`,
          body: operations.failure.message,
          repositoryId: context.id,
        },
        workspace
      );
    }
    return NextResponse.json({ ...operations, repositoryId: context.id });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
