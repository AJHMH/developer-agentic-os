import { NextResponse } from "next/server";

import { IncomingSignalError } from "@/server/incoming-signals/incoming-signal-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import type { IncomingSignalSource, IncomingSignalStatus } from "@/types/incoming-signal";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const context = await repositoryContextForRequest(request, {
      repositoryId: searchParams.get("repositoryId") ?? undefined,
    });
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json({
      signals: await workspace.incomingSignalStore.list({
        repositoryId: context.id,
        source: asSource(searchParams.get("source")),
        status: asStatus(searchParams.get("status")),
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
