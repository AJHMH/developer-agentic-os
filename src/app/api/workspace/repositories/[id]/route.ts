import { NextResponse } from "next/server";

import { WorkspaceError, workspaceStore } from "@/server/workspace/workspace-store";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await workspaceStore.removeRepository((await params).id);
    return NextResponse.json({ removed: true });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
