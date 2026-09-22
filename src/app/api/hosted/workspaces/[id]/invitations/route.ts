import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const invitations = await workspaceStore.listInvitations(identity.userId, workspaceId);
    return NextResponse.json({ invitations });
  });
}

export async function POST(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: { recipientEmail?: unknown; role?: unknown; expiresInSeconds?: unknown } | null;
      try {
        body = (await request.json()) as typeof body;
      } catch {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Request body must be valid JSON.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.recipientEmail !== "string" ||
        !body.recipientEmail.trim() ||
        (body.role !== "admin" && body.role !== "member")
      ) {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json(
              { error: "recipientEmail and a valid role ('admin' | 'member') are required." },
              { status: 400 }
            ),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "recipientEmail and a valid role ('admin' | 'member') are required.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      const expiresInSeconds =
        typeof body.expiresInSeconds === "number" && body.expiresInSeconds > 0
          ? body.expiresInSeconds
          : undefined;

      const invitation = await workspaceStore.createInvitation(identity.userId, workspaceId, {
        recipientEmail: body.recipientEmail,
        role: body.role,
        expiresInSeconds,
      });

      return NextResponse.json({ invitation }, { status: 201 });
    }
  );
}
