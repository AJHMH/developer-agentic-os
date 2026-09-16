import { NextResponse } from "next/server";

import { OperationalStore } from "@/server/operational/operational-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    const store = new OperationalStore(context.path, process.cwd());
    const policyId = new URL(request.url).searchParams.get("policyId");
    return NextResponse.json({
      paused: policyId ? await store.isPolicyPaused(policyId) : await store.isGlobalPaused(),
      scope: policyId ? "policy" : "global",
      policyId,
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const context = await repositoryContextForRequest(request, body);
    const store = new OperationalStore(context.path, process.cwd());
    if (typeof body.paused !== "boolean")
      return NextResponse.json({ error: "paused must be a boolean" }, { status: 400 });
    const paused =
      typeof body.policyId === "string" && body.policyId.trim()
        ? await store.setPolicyPause(body.policyId, body.paused)
        : await store.setGlobalPause(body.paused);
    return NextResponse.json({
      paused,
      scope: body.policyId ? "policy" : "global",
      policyId: body.policyId ?? null,
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "paused must be a boolean" }, { status: 400 });
  }
}
