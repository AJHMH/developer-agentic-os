import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";
import type { ProtectedAction } from "@/types/hosted-workspace";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const approvals = await workspaceStore.listApprovals(identity.userId, workspaceId);
    return NextResponse.json({ approvals });
  });
}

export async function POST(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: {
        actorId?: unknown;
        action?: unknown;
        target?: unknown;
        version?: unknown;
        reason?: unknown;
        expiresInSeconds?: unknown;
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

      const validActions: ProtectedAction[] = [
        "ownership.transfer",
        "workspace.delete",
        "workspace.restore",
        "domain.export_full",
        "policy.update",
      ];

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.actorId !== "string" ||
        !body.actorId.trim() ||
        typeof body.action !== "string" ||
        !validActions.includes(body.action as ProtectedAction) ||
        typeof body.target !== "string" ||
        !body.target.trim() ||
        typeof body.version !== "string" ||
        !body.version.trim() ||
        typeof body.reason !== "string" ||
        !body.reason.trim()
      ) {
        const errorMsg =
          "actorId, action, target, version, and reason are required non-empty fields.";
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

      const expiresInSeconds =
        typeof body.expiresInSeconds === "number" ? body.expiresInSeconds : undefined;

      const approval = await workspaceStore.createApproval(identity.userId, workspaceId, {
        actorId: body.actorId.trim(),
        action: body.action as ProtectedAction,
        target: body.target.trim(),
        version: body.version.trim(),
        reason: body.reason.trim(),
        expiresInSeconds,
      });

      return NextResponse.json({ approval }, { status: 201 });
    }
  );
}
