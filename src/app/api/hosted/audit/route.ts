import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

export async function GET(request: Request) {
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore: hostedWorkspaceStore, domainStore: hostedDomainStore }) => {
      const [workspaceEvents, workspaces] = await Promise.all([
        hostedWorkspaceStore.audit(identity.userId),
        hostedWorkspaceStore.list(identity.userId),
      ]);
      const domainEvents = (
        await Promise.all(
          workspaces.map((workspace) => hostedDomainStore.audit(identity.userId, workspace.id))
        )
      ).flat();
      return NextResponse.json({
        events: [...workspaceEvents, ...domainEvents].sort((left, right) =>
          left.occurredAt.localeCompare(right.occurredAt)
        ),
      });
    }
  );
}
