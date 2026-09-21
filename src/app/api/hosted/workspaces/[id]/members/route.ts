import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const members = await workspaceStore.listMembers(identity.userId, workspaceId);
    return NextResponse.json({ members });
  });
}

export async function PATCH(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: { userId?: unknown; role?: unknown } | null;
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
        typeof body.userId !== "string" ||
        !body.userId.trim() ||
        (body.role !== "admin" && body.role !== "member")
      ) {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json(
              { error: "userId and a valid role ('admin' | 'member') are required." },
              { status: 400 }
            ),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "userId and a valid role ('admin' | 'member') are required.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      const member = await workspaceStore.updateMemberRole(
        identity.userId,
        workspaceId,
        body.userId,
        body.role
      );

      return NextResponse.json({ member });
    }
  );
}

export async function DELETE(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let targetUserId: string | null = null;
      try {
        const body = (await request.json()) as { userId?: unknown } | null;
        if (body && typeof body.userId === "string") {
          targetUserId = body.userId;
        }
      } catch {
        // Query param fallback
      }

      if (!targetUserId) {
        const url = new URL(request.url);
        targetUserId = url.searchParams.get("userId");
      }

      if (!targetUserId || !targetUserId.trim()) {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: "userId is required." }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "userId is required.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      await workspaceStore.removeMember(identity.userId, workspaceId, targetUserId);
      return NextResponse.json({ ok: true });
    }
  );
}
