import { resolveGitHubActionsDeployment } from "@/app/api/hosted/deployments/route";

export async function POST(request: Request) {
  return resolveGitHubActionsDeployment(request);
}
