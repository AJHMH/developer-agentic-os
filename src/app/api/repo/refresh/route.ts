import { NextResponse } from "next/server";

import { refreshRepoMemorySnapshot } from "@/server/repo-memory/repo-memory";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request = new Request("http://localhost")) {
  try {
    const context = await repositoryContextForRequest(request);
    return NextResponse.json(await refreshRepoMemorySnapshot(context.path));
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
