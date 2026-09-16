import { resolveGitHubActionsDeployment } from "@/app/api/hosted/deployments/route";

export async function POST(request: Request) {
  let requestBody: Record<string, unknown> | undefined;
  if (
    (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
    process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
  ) {
    try {
      const parsed: unknown = await request.clone().json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        requestBody = parsed as Record<string, unknown>;
    } catch {
      // Ignore malformed fixture payloads and fall back to OIDC resolution.
    }
  }
  return resolveGitHubActionsDeployment(request, {}, requestBody);
}
