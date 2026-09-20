import { NextResponse } from "next/server";

import { WorkItemError } from "@/server/work-items/work-item-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";
import type { WorkItem, WorkItemStatus } from "@/types/work-item";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as WorkItemStatus | null;

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(
      request,
      searchParams.get("repositoryId") ?? searchParams.get("contextId")
    );
    if (hosted instanceof NextResponse) return hosted;

    const records = await hosted.domainStore.listAllRecords(
      hosted.userId,
      hosted.activeWorkspace.id
    );
    let workItems = ((records.workItems ?? []) as WorkItem[]).map((item) => ({
      ...item,
      statusHistory:
        Array.isArray(item.statusHistory) && item.statusHistory.length > 0
          ? item.statusHistory
          : [
              {
                status: item.status ?? "open",
                changedAt: item.createdAt || new Date().toISOString(),
              },
            ],
    }));
    if (status) {
      workItems = workItems.filter((item) => item.status === status);
    }
    return NextResponse.json({ workItems });
  }

  try {
    const context = await repositoryContextForRequest(request, {
      repositoryId: searchParams.get("repositoryId") ?? undefined,
    });
    const workspace = await createWorkspaceContext(context.path);
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

    if (isHostedMode(request)) {
      const hosted = await resolveHostedWorkspaceContext(
        request,
        body?.repositoryId ?? body?.contextId
      );
      if (hosted instanceof NextResponse) return hosted;

      if (!body || typeof body !== "object" || !body.title || !String(body.title).trim()) {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }

      const now = new Date().toISOString();
      const status = body.status ?? "open";
      const workItem = await hosted.domainStore.putRecord(
        hosted.userId,
        hosted.activeWorkspace.id,
        "workItems",
        {
          title: String(body.title).trim(),
          notes: typeof body.notes === "string" ? body.notes.trim() : "",
          priority: body.priority ?? "normal",
          status,
          statusHistory: [{ status, changedAt: now }],
          dueAt: body.dueAt ?? null,
          contextRefs: Array.isArray(body.contextRefs) ? body.contextRefs : [],
          repositoryId: hosted.activeWorkspace.id,
          createdAt: now,
          updatedAt: now,
        }
      );
      return NextResponse.json(workItem, { status: 201 });
    }

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
