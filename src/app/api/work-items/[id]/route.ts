import { NextResponse } from "next/server";

import { WorkItemError } from "@/server/work-items/work-item-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "A JSON update object is required." }, { status: 400 });

    const { id } = await params;

    if (isHostedMode(request)) {
      const hosted = await resolveHostedWorkspaceContext(
        request,
        body?.repositoryId ?? body?.contextId
      );
      if (hosted instanceof NextResponse) return hosted;

      try {
        const records = await hosted.domainStore.listAllRecords(
          hosted.userId,
          hosted.activeWorkspace.id
        );
        const existing = (records.workItems ?? []).find(
          (item) => (item as { id: string }).id === id
        ) as
          { status?: string; statusHistory?: { status: string; changedAt: string }[] } | undefined;

        const now = new Date().toISOString();
        let statusHistory = existing?.statusHistory;
        if (body.status && (!existing || existing.status !== body.status)) {
          statusHistory = [
            ...(Array.isArray(statusHistory) ? statusHistory : []),
            { status: body.status, changedAt: now },
          ];
        }

        const updatePayload = {
          ...body,
          ...(statusHistory ? { statusHistory } : {}),
          updatedAt: now,
        };

        const updated = await hosted.domainStore.updateRecord(
          hosted.userId,
          hosted.activeWorkspace.id,
          "workItems",
          id,
          updatePayload
        );
        return NextResponse.json(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Record not found";
        return NextResponse.json({ error: message }, { status: 404 });
      }
    }

    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await workspace.workItemStore.update(id, body, context.id));
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
