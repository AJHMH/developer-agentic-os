import { NextResponse } from "next/server";

import { createOperationalExecutor } from "@/server/operational/operational-executor";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const context = await repositoryContextForRequest(request, body);
    const run = await createOperationalExecutor(context.path).runPolicy(
      body.policyId,
      context.id,
      body.trigger === "provider" ? "provider" : "schedule",
      body.input && typeof body.input === "object" ? body.input : {}
    );
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Automation execution failed." },
      { status: 400 }
    );
  }
}
