import { NextResponse } from "next/server";

import { createRoutineRegistry } from "@/server/routines/routine-registry";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await createRoutineRegistry({ context: workspace }).resumeRoutine(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown routine error" },
      { status: 404 }
    );
  }
}
