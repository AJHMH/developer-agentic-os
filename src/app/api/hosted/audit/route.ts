import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

export async function GET(request: Request) {
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore: hostedWorkspaceStore, domainStore: hostedDomainStore }) => {
      const workspaces = await hostedWorkspaceStore.list(identity.userId);
      const workspaceEvents = await hostedWorkspaceStore.audit(identity.userId);

      const domainEvents = (
        await Promise.all(
          workspaces.map((workspace) =>
            hostedDomainStore.mergedAudit(identity.userId, workspace.id)
          )
        )
      ).flat();

      return NextResponse.json({
        events: [...workspaceEvents, ...domainEvents].sort((left: any, right: any) => {
          const timeA = left.occurredAt || left.ingestedAt || "";
          const timeB = right.occurredAt || right.ingestedAt || "";
          if (timeA !== timeB) return timeA.localeCompare(timeB);
          return (left.id || "").localeCompare(right.id || "");
        }),
      });
    }
  );
}
