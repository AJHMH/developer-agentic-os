import { hostedRequestContextStorage } from "@/server/hosted-api/context";

export type TelemetryEvent =
  | "operational_failure"
  | "auth_failure"
  | "persistence_failure"
  | "migration_failure"
  | "sync_conflict";

export function emitTelemetry(event: TelemetryEvent, details: Record<string, unknown>) {
  const context = hostedRequestContextStorage.getStore();
  const payload: Record<string, unknown> = {
    type: "hosted_telemetry",
    event,
    correlationId: details.correlationId ?? context?.correlationId,
    tenantId: details.tenantId ?? context?.tenantId,
    userId: details.userId ?? context?.userId,
    timestamp: new Date().toISOString(),
    ...details,
  };

  // Use console.error so it is routed to stderr, which most observability platforms parse for errors
  console.error(
    JSON.stringify(payload, (key, value) => {
      if (typeof value === "string") {
        return value.replace(/Bearer\s+[^\s]+/g, "Bearer ***");
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message.replace(/Bearer\s+[^\s]+/g, "Bearer ***"),
          stack: value.stack?.replace(/Bearer\s+[^\s]+/g, "Bearer ***"),
        };
      }
      return value;
    })
  );
}
