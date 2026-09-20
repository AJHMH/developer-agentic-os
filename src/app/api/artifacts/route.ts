import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

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
    let artifacts = (records.artifacts ?? []) as any[];
    const type = searchParams.get("type");
    if (type) artifacts = artifacts.filter((a) => a.type === type);
    return NextResponse.json({ artifacts });
  }

  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    const artifacts = await workspace.artifactStore.listArtifacts({
      type: searchParams.get("type") ?? undefined,
      tag: searchParams.get("tag") ?? undefined,
      limit: Number(searchParams.get("limit") ?? 50),
    });

    return NextResponse.json({ artifacts });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.type || body.content === undefined) {
    return NextResponse.json({ error: "name, type, and content are required" }, { status: 400 });
  }

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(
      request,
      body?.repositoryId ?? body?.contextId
    );
    if (hosted instanceof NextResponse) return hosted;

    const artifact = await hosted.domainStore.putRecord(
      hosted.userId,
      hosted.activeWorkspace.id,
      "artifacts",
      {
        id: randomUUID(),
        name: body.name,
        type: body.type,
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags : [],
        contextRefs: Array.isArray(body.contextRefs) ? body.contextRefs : [],
        createdAt: new Date().toISOString(),
      }
    );
    return NextResponse.json(artifact, { status: 201 });
  }

  try {
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    const artifact = await workspace.artifactStore.createArtifact({
      name: body.name,
      type: body.type,
      content: body.content,
      tags: Array.isArray(body.tags) ? body.tags : [],
      contextRefs: Array.isArray(body.contextRefs) ? body.contextRefs : [],
      provenance: Array.isArray(body.workflowRefs)
        ? {
            repositoryId: context.id,
            repositoryRoot: context.path,
            workflowRefs: body.workflowRefs,
          }
        : undefined,
    });
    return NextResponse.json(artifact, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
