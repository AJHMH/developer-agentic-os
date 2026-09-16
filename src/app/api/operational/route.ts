import { NextResponse } from "next/server";

import { OperationalStore } from "@/server/operational/operational-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    const store = new OperationalStore(context.path, process.cwd());
    const [events, incidents, policies, runs, audits] = await Promise.all([
      store.listEvents({ repositoryId: context.id }),
      store.listIncidents({ repositoryId: context.id }),
      store.listPolicies({ repositoryId: context.id }),
      store.listRuns({ repositoryId: context.id }),
      store.listAudits({ repositoryId: context.id }),
    ]);
    return NextResponse.json({
      repositoryId: context.id,
      globalPaused: await store.isGlobalPaused(),
      events,
      incidents,
      policies,
      runs,
      audits,
    });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
