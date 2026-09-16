import { NextResponse } from "next/server";

import { getIntegrationStatuses } from "@/server/integrations/integration-registry";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request = new Request("http://localhost")) {
  try {
    const context = await repositoryContextForRequest(request);
    return NextResponse.json({ integrations: await getIntegrationStatuses(context.path) });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
