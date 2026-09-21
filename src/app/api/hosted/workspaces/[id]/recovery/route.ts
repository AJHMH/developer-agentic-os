import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const recovery = await workspaceStore.getWorkspaceRecovery(identity.userId, workspaceId);
    return NextResponse.json({ recovery });
  });
}

export async function POST(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    let approvalId = request.headers.get("x-approval-id")?.trim() || undefined;
    let expectedVersion = request.headers.get("x-version")?.trim() || undefined;
    try {
      const body = (await request.json()) as { approvalId?: unknown; version?: unknown } | null;
      if (body && typeof body.approvalId === "string" && body.approvalId.trim()) {
        approvalId = body.approvalId.trim();
      }
      if (body && typeof body.version === "string" && body.version.trim()) {
        expectedVersion = body.version.trim();
      }
    } catch {
      // Optional body
    }

    const workspace = await workspaceStore.restoreWorkspace(identity.userId, workspaceId, {
      approvalId,
      version: expectedVersion,
    });

    return NextResponse.json({ ok: true, workspace });
  });
}
