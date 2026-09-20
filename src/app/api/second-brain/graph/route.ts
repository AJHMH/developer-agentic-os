import { NextResponse } from "next/server";

import {
  buildHostedSecondBrainGraph,
  buildSecondBrainGraph,
} from "@/server/second-brain/second-brain-graph";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { createWorkspaceContext } from "@/server/workspace/workspace-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request: Request = new Request("http://localhost")) {
  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;

    const records = await hosted.domainStore.listAllRecords(
      hosted.userId,
      hosted.activeWorkspace.id
    );
    return NextResponse.json(
      await buildHostedSecondBrainGraph(
        hosted.activeWorkspace.id,
        hosted.activeWorkspace.name,
        records as any
      )
    );
  }

  try {
    const context = await repositoryContextForRequest(request);
    const workspace = await createWorkspaceContext(context.path);
    return NextResponse.json(await buildSecondBrainGraph(workspace));
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
