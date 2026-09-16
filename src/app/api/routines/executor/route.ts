import { NextResponse } from "next/server";

import { localBackgroundExecutor } from "@/server/routines/local-background-executor";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(): Promise<Response> {
  return NextResponse.json({ executor: await localBackgroundExecutor.status() });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      repositoryId?: string;
    };
    const context =
      body.repositoryId || new URL(request.url).searchParams.get("repositoryId")
        ? await repositoryContextForRequest(request, body)
        : undefined;
    const trigger = context ? { repositoryId: context.id } : {};
    if (body.action === "start")
      return NextResponse.json({ executor: await localBackgroundExecutor.start(trigger) });
    if (body.action === "stop")
      return NextResponse.json({ executor: await localBackgroundExecutor.stop() });
    if (body.action === "trigger")
      return NextResponse.json(await localBackgroundExecutor.trigger(trigger));
    return NextResponse.json({ error: "Action must be start, stop, or trigger." }, { status: 400 });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Executor action failed." },
      { status: 422 }
    );
  }
}
