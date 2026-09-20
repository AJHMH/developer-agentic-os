import { NextResponse } from "next/server";

import { IncomingSignalError } from "@/server/incoming-signals/incoming-signal-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";
import type {
  IncomingSignal,
  IncomingSignalSource,
  IncomingSignalStatus,
} from "@/types/incoming-signal";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = asSource(searchParams.get("source"));
  const status = asStatus(searchParams.get("status"));

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(
      request,
      searchParams.get("repositoryId") ?? searchParams.get("contextId")
    );
    if (hosted instanceof NextResponse) return hosted;

    const records = await hosted.domainStore.listAllRecords(
      hosted.userId,
      hosted.activeWorkspace.id
    );
    let signals = (records.incomingSignals ?? []) as IncomingSignal[];
    if (source) signals = signals.filter((s) => s.source === source);
    if (status) signals = signals.filter((s) => s.status === status);
    return NextResponse.json({ signals });
  }

  try {
    const context = await repositoryContextForRequest(request, {
      repositoryId: searchParams.get("repositoryId") ?? undefined,
    });
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json({
      signals: await workspace.incomingSignalStore.list({
        repositoryId: context.id,
        source,
        status,
      }),
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (isHostedMode(request)) {
      const hosted = await resolveHostedWorkspaceContext(
        request,
        body?.repositoryId ?? body?.contextId
      );
      if (hosted instanceof NextResponse) return hosted;

      if (!body?.title || !String(body.title).trim()) {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }

      const signal = await hosted.domainStore.putRecord(
        hosted.userId,
        hosted.activeWorkspace.id,
        "incomingSignals",
        {
          title: String(body.title).trim(),
          body: typeof body.body === "string" ? body.body.trim() : "",
          source: body.source ?? "manual",
          status: body.status ?? "new",
          repositoryId: hosted.activeWorkspace.id,
          createdAt: new Date().toISOString(),
        }
      );
      return NextResponse.json(signal, { status: 201 });
    }

    if (!body?.repositoryId && !body?.contextId && !body?.repositoryRoot && !body?.root)
      return NextResponse.json(
        { error: "repositoryId or repositoryRoot is required" },
        { status: 400 }
      );
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(
      await workspace.incomingSignalStore.create({ ...body, repositoryId: context.id }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof IncomingSignalError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

function asSource(value: string | null): IncomingSignalSource | undefined {
  return value === "manual" || value === "email" ? value : undefined;
}

function asStatus(value: string | null): IncomingSignalStatus | undefined {
  return value === "new" || value === "snoozed" || value === "dismissed" || value === "triaged"
    ? value
    : undefined;
}
