import { NextResponse } from "next/server";

import { buildHostedFocusBoard, getFocusBoard } from "@/server/focus-board/focus-board";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 12);
  const boundedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12;

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;

    const records = await hosted.domainStore.listAllRecords(
      hosted.userId,
      hosted.activeWorkspace.id
    );
    return NextResponse.json(
      buildHostedFocusBoard(hosted.activeWorkspace.id, records as any, boundedLimit)
    );
  }

  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(
      await getFocusBoard(context.id, context.path, {
        context: workspace,
        limit: boundedLimit,
      })
    );
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
