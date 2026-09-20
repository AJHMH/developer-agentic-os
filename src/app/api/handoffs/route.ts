import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { HandoffError } from "@/server/handoffs/handoff-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request: Request) {
  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;

    const records = await hosted.domainStore.listAllRecords(
      hosted.userId,
      hosted.activeWorkspace.id
    );
    return NextResponse.json({ handoffs: (records as Record<string, unknown[]>).handoffs ?? [] });
  }

  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json({ handoffs: await workspace.handoffStore.list(context.id) });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (isHostedMode(request)) {
      const hosted = await resolveHostedWorkspaceContext(
        request,
        body?.repositoryId ?? body?.contextId
      );
      if (hosted instanceof NextResponse) return hosted;

      const now = new Date().toISOString();
      const handoff = await hosted.domainStore.putRecord(
        hosted.userId,
        hosted.activeWorkspace.id,
        "handoffs" as any,
        {
          id: randomUUID(),
          title: body?.title || `Handoff ${now}`,
          decisions: body?.decisions || "",
          blockers: body?.blockers || "",
          nextActions: body?.nextActions || "",
          status: "draft",
          createdAt: now,
          updatedAt: now,
          snapshot: {
            capturedAt: now,
            repositoryContext: hosted.repositoryContext,
            git: {
              branch: "main",
              clean: true,
              commitsAhead: 0,
              commitsBehind: 0,
              modifiedCount: 0,
              untrackedCount: 0,
            },
            workItems: [],
            artifacts: [],
          },
        }
      );
      return NextResponse.json(handoff, { status: 201 });
    }

    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await workspace.handoffStore.create(context, body), { status: 201 });
  } catch (error) {
    if (error instanceof HandoffError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
