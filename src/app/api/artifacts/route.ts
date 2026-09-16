import { NextResponse } from "next/server";

import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
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
  const body = await request.json();
  if (!body?.name || !body?.type || body.content === undefined) {
    return NextResponse.json({ error: "name, type, and content are required" }, { status: 400 });
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
