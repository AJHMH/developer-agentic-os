import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";

type RouteProps = {
  params: Promise<{ id: string; approvalId: string }>;
};

export async function POST(request: Request, props: RouteProps) {
  const { id: workspaceId, approvalId } = await props.params;
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    const approval = await workspaceStore.revokeApproval(identity.userId, workspaceId, approvalId);
    return NextResponse.json({ approval });
  });
}
