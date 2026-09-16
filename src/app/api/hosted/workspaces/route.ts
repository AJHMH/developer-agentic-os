import { NextResponse } from "next/server";

import { hostedIdentity, hostedError } from "@/app/api/hosted/_shared";

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const hostedWorkspaceStore = identity.workspaceStore;
  try {
    await hostedWorkspaceStore.ensureDefault(identity.userId);
    const workspaces = await hostedWorkspaceStore.list(identity.userId);
    await hostedWorkspaceStore.recordList(identity.userId);
    return NextResponse.json({
      workspaces,
      activeWorkspace: await hostedWorkspaceStore.active(identity.userId),
    });
  } catch (error) {
    return hostedError(error);
  }
}

export async function POST(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const hostedWorkspaceStore = identity.workspaceStore;
  try {
    let body: { name?: unknown } | null;
    try {
      body = (await request.json()) as { name?: unknown } | null;
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.name !== "string")
      return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
    return NextResponse.json(
      { workspace: await hostedWorkspaceStore.create(identity.userId, body.name) },
      { status: 201 }
    );
  } catch (error) {
    return hostedError(error);
  }
}
