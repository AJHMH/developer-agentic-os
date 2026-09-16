import { NextResponse } from "next/server";

import { OperationalStore } from "@/server/operational/operational-store";
import { createOperationalExecutor } from "@/server/operational/operational-executor";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    return NextResponse.json({
      runs: await new OperationalStore(context.path).listRuns({ repositoryId: context.id }),
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
    if (
      typeof body?.policyId !== "string" ||
      !["schedule", "provider"].includes(body.trigger ?? "")
    )
      return NextResponse.json(
        { error: "policyId and a valid trigger are required" },
        { status: 400 }
      );
    const run = await createOperationalExecutor(context.path, process.cwd()).runPolicy(
      body.policyId,
      context.id,
      body.trigger,
      body.input && typeof body.input === "object" && !Array.isArray(body.input) ? body.input : {}
    );
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Invalid automation run." }, { status: 400 });
  }
}
