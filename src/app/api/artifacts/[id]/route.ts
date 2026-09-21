import { NextResponse } from "next/server";

import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (isHostedMode(_request)) {
    const hosted = await resolveHostedWorkspaceContext(_request);
    if (hosted instanceof NextResponse) return hosted;

    const artifact = await hosted.domainStore.getArtifact(
      hosted.userId,
      hosted.activeWorkspace.id,
      id
    );
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    return NextResponse.json(artifact);
  }

  try {
    const context = await repositoryContextForRequest(_request);
    const workspace = await createWorkspaceContext(context.path);
    const artifact = await workspace.artifactStore.getArtifact(id);
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

    return NextResponse.json(artifact);
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
