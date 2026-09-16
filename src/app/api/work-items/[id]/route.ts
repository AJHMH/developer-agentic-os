import { NextResponse } from "next/server";

import { WorkItemError } from "@/server/work-items/work-item-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "A JSON update object is required." }, { status: 400 });
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(
      await workspace.workItemStore.update((await params).id, body, context.id)
    );
  } catch (error) {
    if (error instanceof WorkItemError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "NOT_FOUND" ? 404 : 400 }
      );
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
