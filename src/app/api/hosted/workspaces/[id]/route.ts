import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const workspace = await workspaceStore.get(identity.userId, workspaceId);
    const role = await workspaceStore.getRole(identity.userId, workspaceId);
    return NextResponse.json({ workspace, role });
  });
}

export async function DELETE(request: Request, props: RouteProps) {
  const { id: workspaceId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    let approvalId = request.headers.get("x-approval-id")?.trim() || undefined;
    let version: string | undefined;

    try {
      const body = (await request.json()) as { approvalId?: unknown; version?: unknown } | null;
      if (body && typeof body === "object") {
        if (typeof body.approvalId === "string" && body.approvalId.trim()) {
          approvalId = body.approvalId.trim();
        }
        if (typeof body.version === "string" && body.version.trim()) {
          version = body.version.trim();
        }
      }
    } catch {
      // Body is optional on DELETE
    }

    if (!approvalId) {
      const url = new URL(request.url);
      approvalId = url.searchParams.get("approvalId")?.trim() || undefined;
    }

    const recoveryInfo = await workspaceStore.softDeleteWorkspace(identity.userId, workspaceId, {
      approvalId,
      version,
    });

    return NextResponse.json({
      ok: true,
      workspaceId,
      status: "tombstoned",
      recovery: recoveryInfo,
    });
  });
}
