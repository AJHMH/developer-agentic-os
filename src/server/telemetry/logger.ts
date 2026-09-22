import { hostedRequestContextStorage } from "@/server/hosted-api/context";

export type TelemetryEvent =
  | "operational_failure"
  | "auth_failure"
  | "persistence_failure"
  | "migration_failure"
  | "sync_conflict";

export function emitTelemetry(event: TelemetryEvent, details: Record<string, unknown>) {
  const context = hostedRequestContextStorage.getStore();
  const payload = {
    type: "hosted_telemetry",
    event,
    correlationId: context?.correlationId,
    tenantId: context?.tenantId,
    userId: context?.userId,
    timestamp: new Date().toISOString(),
    ...details,
  };

  // Redact secrets
  if (typeof payload.message === "string") {
    payload.message = payload.message.replace(/Bearer\s+[^\s]+/g, "Bearer ***");
  }
  if (details.error instanceof Error) {
    const message = details.error.message.replace(/Bearer\s+[^\s]+/g, "Bearer ***");
    payload.error = {
      name: details.error.name,
      message,
    };
  }

  // Use console.error so it is routed to stderr, which most observability platforms parse for errors
  console.error(JSON.stringify(payload));
}
