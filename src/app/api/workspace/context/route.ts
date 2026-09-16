import { NextResponse } from "next/server";

import { WorkspaceError, workspaceStore } from "@/server/workspace/workspace-store";

export async function GET() {
  return NextResponse.json({ context: await workspaceStore.getActiveContext() });
}

export async function PUT(request: Request) {
  return setContext(request);
}

export async function POST(request: Request) {
  return setContext(request);
}

async function setContext(request: Request) {
  const body = await request.json();
  const id = body?.id ?? body?.repositoryId;
  if (typeof id !== "string" || !id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    return NextResponse.json({ context: await workspaceStore.setActiveContext(id) });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
