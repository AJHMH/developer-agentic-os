import type { IntegrationAdapterStatus } from "@/types/integration";

/**
 * Deferred integration definitions - these are planned but not yet implemented.
 * This is a pure data module - no dependencies, no orchestration.
 */
export const deferredIntegrations: Omit<IntegrationAdapterStatus, "status" | "message">[] = [
  {
    id: "sentry",
    name: "Sentry",
    kind: "observability",
    required: false,
    capabilities: ["events and outages", "breached metrics", "warnings", "traces", "errors"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "cloud",
    required: false,
    capabilities: ["domains", "workers"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "coderabbit",
    name: "CodeRabbit",
    kind: "observability",
    required: false,
    capabilities: ["code review insights"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "workos",
    name: "WorkOS",
    kind: "identity",
    required: false,
    capabilities: ["identity health"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "clerk",
    name: "Clerk",
    kind: "identity",
    required: false,
    capabilities: ["authentication health"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "convex",
    name: "Convex",
    kind: "database",
    required: false,
    capabilities: ["health"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "neondb",
    name: "NeonDB",
    kind: "database",
    required: false,
    capabilities: ["health"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "upstash",
    name: "Upstash",
    kind: "database",
    required: false,
    capabilities: ["health"],
    setup: "This integration is staged for a later milestone.",
  },
  {
    id: "slack",
    name: "Slack",
    kind: "chat",
    required: false,
    capabilities: ["routine notifications"],
    setup: "This integration is staged for a later milestone.",
  },
];

/**
 * Create a deferred integration status entry.
 */
export function createDeferredIntegration(
  id: string,
  name: string,
  kind: IntegrationAdapterStatus["kind"],
  capabilities: string[]
): IntegrationAdapterStatus {
  return {
    id,
    name,
    kind,
    required: false,
    status: "deferred",
    capabilities,
    setup: "This integration is staged for a later milestone.",
    message: "Health monitoring is staged for a later milestone.",
  };
}
