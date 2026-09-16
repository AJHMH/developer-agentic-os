import { NextResponse } from "next/server";

import { SignalTriageError, triageSignal } from "@/server/incoming-signals/signal-triage";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => null);
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "A JSON triage action is required." }, { status: 400 });
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await triageSignal(workspace, (await params).id, body, context.id));
  } catch (error) {
    if (error instanceof SignalTriageError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "NOT_FOUND" ? 404 : 400 }
      );
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
