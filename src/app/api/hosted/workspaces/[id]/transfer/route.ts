import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: {
        targetUserId?: unknown;
        approvalId?: unknown;
        version?: unknown;
      } | null;
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
        typeof body.targetUserId !== "string" ||
        !body.targetUserId.trim()
      ) {
        const errorMsg = "targetUserId is required.";
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: errorMsg }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: errorMsg,
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      const approvalId =
        typeof body.approvalId === "string" && body.approvalId.trim()
          ? body.approvalId.trim()
          : request.headers.get("x-approval-id")?.trim() || undefined;

      const expectedVersion =
        typeof body.version === "string" && body.version.trim() ? body.version.trim() : undefined;

      const result = await workspaceStore.transferOwnership(
        identity.userId,
        workspaceId,
        body.targetUserId.trim(),
        {
          approvalId,
          version: expectedVersion,
        }
      );

      return NextResponse.json(result);
    }
  );
}
