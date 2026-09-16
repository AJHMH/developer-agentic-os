import type { IntegrationAdapterStatus } from "@/types/integration";
import { LocalEmailAdapter } from "../email/email-adapter";
import { LocalGitAdapter } from "../git/local-git-adapter";
import { SentryAdapter } from "./sentry-adapter";
import { createDeferredIntegration } from "./integration-definitions";

/**
 * Get integration statuses for the current environment.
 * Returns both connected/unconfigured adapters and deferred integrations.
 *
 * Architecture:
 * - Adapter statuses: Determined by checking environment variables and adapter availability
 * - Deferred integrations: Pulled from integration-definitions.ts (pure data)
 *
 * Refactoring note: This registry is kept simple since it's primarily a catalog function.
 * Unlike skills/routines which have complex orchestration, integrations are mostly static
 * definitions with minimal dynamic status checking.
 */
export async function getIntegrationStatuses(
  root = process.cwd(),
  env: Record<string, string | undefined> = process.env
): Promise<IntegrationAdapterStatus[]> {
  const git = await new LocalGitAdapter(root).getStatus();
  const email = new LocalEmailAdapter(root, env).getStatus();
  const hasGitHubToken = Boolean(env.GITHUB_TOKEN || env.GH_TOKEN);
  const hasVercelToken = Boolean(env.VERCEL_TOKEN || env.VERCEL_API_TOKEN);
  const hasVercelProject = Boolean(env.VERCEL_PROJECT_ID);
  const sentryObservations = await new SentryAdapter(
    env,
    fetch as (input: string, init?: RequestInit) => Promise<Response>,
    root
  ).getObservations();
  const sentryObservation = sentryObservations[0];

  return [
    {
      id: "local-git",
      name: "Local Git",
      kind: "local",
      required: true,
      status: git.available ? "connected" : "error",
      capabilities: ["current branch", "recent commits", "changed files"],
      message: git.message,
    },
    {
      id: "github",
      name: "GitHub",
      kind: "scm",
      required: false,
      status: hasGitHubToken ? "connected" : "unconfigured",
      capabilities: ["issues", "pull requests", "Actions", "merge status"],
      setup: "Set GITHUB_TOKEN or GH_TOKEN and GITHUB_REPOSITORY to enable GitHub operations.",
      message: hasGitHubToken
        ? "GitHub credentials detected."
        : "GitHub credentials are not configured.",
    },
    env.VERCEL_INTEGRATION_ENABLED === "false"
      ? {
          id: "vercel",
          name: "Vercel",
          kind: "cloud",
          required: false,
          status: "disabled",
          capabilities: ["deployments", "build logs", "runtime logs"],
          setup: "Set VERCEL_INTEGRATION_ENABLED=true to enable Vercel operations.",
          message: "Vercel integration is disabled by configuration.",
        }
      : {
          id: "vercel",
          name: "Vercel",
          kind: "cloud",
          required: false,
          status: hasVercelToken && hasVercelProject ? "connected" : "unconfigured",
          capabilities: ["deployments", "build logs", "runtime logs"],
          setup:
            "Set VERCEL_TOKEN or VERCEL_API_TOKEN and VERCEL_PROJECT_ID to enable Vercel operations.",
          message:
            hasVercelToken && hasVercelProject
              ? "Vercel credentials detected."
              : "Vercel credentials or project configuration are missing.",
        },
    {
      id: "sentry",
      name: "Sentry",
      kind: "observability",
      required: false,
      status:
        sentryObservation?.state === "healthy"
          ? "healthy"
          : sentryObservation?.state === "unhealthy" ||
              sentryObservation?.state === "authentication" ||
              sentryObservation?.state === "timeout" ||
              sentryObservation?.state === "rate_limit" ||
              sentryObservation?.state === "unavailable"
            ? "unhealthy"
            : "unconfigured",
      capabilities: ["events and outages", "breached metrics", "warnings", "traces", "errors"],
      setup: "Set SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT or configure .sentryclirc.",
      message: sentryObservation?.title ?? "Sentry status is unavailable.",
    },
    createDeferredIntegration("cloudflare", "Cloudflare", "cloud", ["domains", "workers"]),
    createDeferredIntegration("coderabbit", "CodeRabbit", "observability", [
      "code review insights",
    ]),
    createDeferredIntegration("workos", "WorkOS", "identity", ["identity health"]),
    createDeferredIntegration("clerk", "Clerk", "identity", ["authentication health"]),
    createDeferredIntegration("convex", "Convex", "database", ["health"]),
    createDeferredIntegration("neondb", "NeonDB", "database", ["health"]),
    createDeferredIntegration("upstash", "Upstash", "database", ["health"]),
    email,
    createDeferredIntegration("slack", "Slack", "chat", ["routine notifications"]),
  ];
}
