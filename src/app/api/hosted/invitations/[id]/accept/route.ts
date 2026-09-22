import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, props: RouteProps) {
  const { id: invitationId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    let userEmail: string | undefined;
    try {
      const body = (await request.json()) as { recipientEmail?: unknown } | null;
      if (body && typeof body.recipientEmail === "string") {
        userEmail = body.recipientEmail;
      }
    } catch {
      // Empty or non-JSON body is acceptable for accept
    }

    const result = await workspaceStore.acceptInvitation(identity.userId, invitationId, userEmail);
    return NextResponse.json({
      workspace: result.workspace,
      member: result.member,
    });
  });
}
