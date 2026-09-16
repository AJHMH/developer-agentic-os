import { NextResponse } from "next/server";

import { createRoutineRegistry } from "@/server/routines/routine-registry";
import { localBackgroundExecutor } from "@/server/routines/local-background-executor";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request = new Request("http://localhost")) {
  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json({
      routines: await createRoutineRegistry({ context: workspace }).listRoutines(),
      executor: await localBackgroundExecutor.status(),
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
