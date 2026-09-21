import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const policy = await workspaceStore.getPolicy(identity.userId, workspaceId);
    return NextResponse.json({ policy });
  });
}

export async function PATCH(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: {
        requireApprovalForDelete?: unknown;
        requireApprovalForExport?: unknown;
        requireApprovalForTransfer?: unknown;
        approvalExpiryWindowSeconds?: unknown;
        approvalId?: unknown;
        expectedVersion?: unknown;
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

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: "Valid JSON object required." }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Valid JSON object required.",
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

      if (typeof body.expectedVersion !== "number") {
        const errorMsg = "expectedVersion (number) is required for concurrency control.";
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

      const expectedVersion = body.expectedVersion;

      const updates = {
        ...(typeof body.requireApprovalForDelete === "boolean"
          ? { requireApprovalForDelete: body.requireApprovalForDelete }
          : {}),
        ...(typeof body.requireApprovalForExport === "boolean"
          ? { requireApprovalForExport: body.requireApprovalForExport }
          : {}),
        ...(typeof body.requireApprovalForTransfer === "boolean"
          ? { requireApprovalForTransfer: body.requireApprovalForTransfer }
          : {}),
        ...(typeof body.approvalExpiryWindowSeconds === "number"
          ? { approvalExpiryWindowSeconds: body.approvalExpiryWindowSeconds }
          : {}),
      };

      const policy = await workspaceStore.updatePolicy(identity.userId, workspaceId, updates, {
        approvalId,
        expectedVersion,
      });

      return NextResponse.json({ policy });
    }
  );
}
