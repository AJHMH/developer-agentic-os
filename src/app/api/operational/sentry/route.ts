import { NextResponse } from "next/server";

import { SentryAdapter } from "@/server/integrations/sentry-adapter";
import { OperationalStore } from "@/server/operational/operational-store";
import { createOperationalExecutor } from "@/server/operational/operational-executor";
import { recordIntegrationFailure } from "@/server/incoming-signals/integration-failure";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await repositoryContextForRequest(request);
    const observations = await new SentryAdapter(
      process.env,
      fetch,
      context.path
    ).getObservations();
    const store = new OperationalStore(context.path);
    const events = [];
    for (const observation of observations) {
      const result = await store.ingestEvent({
        repositoryId: context.id,
        triggerType: "provider",
        provider: "sentry",
        capability: "errors",
        sourceId: observation.sourceId,
        observedAt: observation.observedAt,
        title: observation.title,
        details: { ...observation.details, state: observation.state, project: observation.project },
      });
      let incident = await store.groupEvent(result.event);
      if (
        result.created &&
        observation.state !== "healthy" &&
        observation.state !== "unconfigured"
      ) {
        const signal = await recordIntegrationFailure(context.path, {
          provider: "sentry",
          sourceId: `sentry:${observation.sourceId ?? observation.state}`,
          title: observation.title,
          body: JSON.stringify(observation.details),
          repositoryId: context.id,
        });
        incident = await store.attachSignal(incident.id, context.id, signal.id);
      }
      const runs = result.created
        ? await Promise.all(
            (await store.listPolicies({ repositoryId: context.id }))
              .filter((policy) => policy.enabled && policy.triggers.includes("provider"))
              .map((policy) =>
                createOperationalExecutor(context.path, process.cwd()).runPolicy(
                  policy.id,
                  context.id,
                  "provider",
                  {
                    eventId: result.event.id,
                    incidentId: incident.id,
                    observation: observation.details,
                  }
                )
              )
          )
        : [];
      events.push({ ...result, incident, runs });
    }
    return NextResponse.json({ repositoryId: context.id, observations, events, readOnly: true });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
