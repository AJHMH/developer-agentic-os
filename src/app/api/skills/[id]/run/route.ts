import { NextResponse } from "next/server";

import { createSkillRegistry } from "@/server/skills/skill-registry";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const context = await repositoryContextForRequest(request, body);
    const workspace = await createWorkspaceContext(context.path);
    const result = await createSkillRegistry({ context: workspace }).runSkill(
      id,
      body?.input ?? {}
    );
    return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown skill error";
    return NextResponse.json(
      { error: message },
      {
        status: error instanceof WorkspaceError || message.startsWith("Unknown skill:") ? 404 : 422,
      }
    );
  }
}
