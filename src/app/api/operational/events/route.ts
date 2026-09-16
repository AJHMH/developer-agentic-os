import { NextResponse } from "next/server";

import { OperationalStore, OperationalStoreError } from "@/server/operational/operational-store";
import { recordIntegrationFailure } from "@/server/incoming-signals/integration-failure";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";
import { createOperationalExecutor } from "@/server/operational/operational-executor";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    return NextResponse.json({
      events: await new OperationalStore(context.path).listEvents({ repositoryId: context.id }),
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
    const store = new OperationalStore(context.path);
    const result = await store.ingestEvent({ ...body, repositoryId: context.id });
    let incident = await store.groupEvent(result.event);
    const details = result.event.details;
    if (
      result.created &&
      (details.failure === true ||
        details.status === "failed" ||
        details.state === "error" ||
        details.state === "unhealthy")
    ) {
      const signal = await recordIntegrationFailure(context.path, {
        provider: result.event.provider,
        sourceId: result.event.sourceId ?? result.event.deduplicationKey,
        title: result.event.title,
        body: JSON.stringify(details),
        repositoryId: context.id,
      });
      incident = await store.attachSignal(incident.id, context.id, signal.id);
    }
    const runs = result.created
      ? await Promise.all(
          (await store.listPolicies({ repositoryId: context.id }))
            .filter((policy) => policy.enabled && policy.triggers.includes("provider"))
            .map((policy) =>
              createOperationalExecutor(context.path).runPolicy(policy.id, context.id, "provider", {
                eventId: result.event.id,
                incidentId: incident.id,
              })
            )
        )
      : [];
    return NextResponse.json({ ...result, incident, runs }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof OperationalStoreError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Invalid operational event." }, { status: 400 });
  }
}
