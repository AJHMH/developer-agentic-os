import { NextResponse } from "next/server";

import { OperationalStore, OperationalStoreError } from "@/server/operational/operational-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    return NextResponse.json({
      policies: await new OperationalStore(context.path).listPolicies({ repositoryId: context.id }),
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
    if (!body?.repositoryId && !body?.contextId && !body?.repositoryRoot && !body?.root)
      return NextResponse.json(
        { error: "repositoryId or repositoryRoot is required" },
        { status: 400 }
      );
    const context = await repositoryContextForRequest(request, body);
    return NextResponse.json(
      await new OperationalStore(context.path).savePolicy({ ...body, repositoryId: context.id }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof OperationalStoreError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Invalid automation policy." }, { status: 400 });
  }
}
