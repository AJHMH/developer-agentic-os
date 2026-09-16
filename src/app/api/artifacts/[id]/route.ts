import { NextResponse } from "next/server";

import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
