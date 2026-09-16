import { NextResponse } from "next/server";

import { WorkItemError } from "@/server/work-items/work-item-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import type { WorkItemStatus } from "@/types/work-item";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const context = await repositoryContextForRequest(request, {
      repositoryId: searchParams.get("repositoryId") ?? undefined,
    });
    const workspace = await createWorkspaceContext(context.path);
    const status = searchParams.get("status") as WorkItemStatus | null;
    return NextResponse.json({
      workItems: await workspace.workItemStore.list({
        repositoryId: context.id,
        status: status ?? undefined,
      }),
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.repositoryId && !body?.contextId && !body?.repositoryRoot && !body?.root) {
      return NextResponse.json(
        { error: "repositoryId or repositoryRoot is required" },
        { status: 400 }
      );
    }
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(
      await workspace.workItemStore.create({ ...body, repositoryId: context.id }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof WorkItemError && error.code === "INVALID_INPUT")
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
