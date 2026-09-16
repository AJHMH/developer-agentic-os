import { NextResponse } from "next/server";

import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json({
      runs: await workspace.skillRunStore.listRuns({
        skillId: searchParams.get("skillId") ?? undefined,
        limit: Number(searchParams.get("limit") ?? 50),
      }),
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
