import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, props: RouteProps) {
  const { id: invitationId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    let workspaceId: string | undefined;
    try {
      const body = (await request.json()) as { workspaceId?: unknown } | null;
      if (body && typeof body.workspaceId === "string") {
        workspaceId = body.workspaceId;
      }
    } catch {
      // Body is optional
    }

    const invitation = await workspaceStore.revokeInvitation(
      identity.userId,
      invitationId,
      workspaceId
    );
    return NextResponse.json({ invitation });
  });
}
