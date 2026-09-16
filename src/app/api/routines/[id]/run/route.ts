import { NextResponse } from "next/server";

import { createRoutineRegistry } from "@/server/routines/routine-registry";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    const result = await createRoutineRegistry({ context: workspace }).runRoutine(id);
    return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown routine error";
    return NextResponse.json(
      { error: message },
      {
        status:
          error instanceof WorkspaceError || message.startsWith("Unknown routine:") ? 404 : 422,
      }
    );
  }
}
