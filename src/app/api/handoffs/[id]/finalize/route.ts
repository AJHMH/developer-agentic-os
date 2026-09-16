import { NextResponse } from "next/server";

import { HandoffError } from "@/server/handoffs/handoff-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await workspace.handoffStore.finalize((await params).id, context.id));
  } catch (error) {
    if (error instanceof HandoffError || error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
