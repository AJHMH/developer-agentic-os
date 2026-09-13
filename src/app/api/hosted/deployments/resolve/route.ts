import {
  resolveGitHubActionsDeployment,
  type GitHubActionsDeploymentDependencies,
} from "@/app/api/hosted/deployments/route";

export async function POST(
  request: Request,
  dependencies?: GitHubActionsDeploymentDependencies
) {
  return resolveGitHubActionsDeployment(request, dependencies);
}
