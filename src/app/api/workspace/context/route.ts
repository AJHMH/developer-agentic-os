import { NextResponse } from "next/server";

import { WorkspaceError, workspaceStore } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request?: Request) {
  if (isHostedMode(request)) {
    if (!request)
      return NextResponse.json({ error: "Request is required in hosted mode" }, { status: 400 });
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;
    return NextResponse.json({ context: hosted.repositoryContext });
  }
  return NextResponse.json({ context: await workspaceStore.getActiveContext() });
}

export async function PUT(request: Request) {
  return setContext(request);
}

export async function POST(request: Request) {
  return setContext(request);
}

async function setContext(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = body?.id ?? body?.repositoryId;
  if (typeof id !== "string" || !id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(request, id);
    if (hosted instanceof NextResponse) return hosted;
    try {
      await hosted.workspaceStore.select(hosted.userId, id);
      return NextResponse.json({
        context: {
          id: hosted.activeWorkspace.id,
          name: hosted.activeWorkspace.name,
          path: `/workspaces/${hosted.activeWorkspace.name}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace not found";
      return NextResponse.json({ error: message }, { status: 404 });
    }
  }

  try {
    return NextResponse.json({ context: await workspaceStore.setActiveContext(id) });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
