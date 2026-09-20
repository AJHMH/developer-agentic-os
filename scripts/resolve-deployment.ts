import { appendFile } from "node:fs/promises";

import {
  DeploymentWorkflowError,
  resolveDeploymentWorkflowTarget,
} from "../src/server/hosted-deployments/deployment-workflow";

export async function fetchGitHubActionsOidcToken(
  audience = "developer-agentic-os",
  fetcher: typeof fetch = fetch
): Promise<string> {
  const directToken = process.env.ACTIONS_ID_TOKEN || process.env.GITHUB_ACTIONS_OIDC_TOKEN;
  if (directToken?.trim()) return directToken.trim();

  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub Actions OIDC environment is not available. Ensure 'permissions: id-token: write' is enabled in the workflow."
    );
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetcher(url.toString(), {
    headers: {
      authorization: `Bearer ${requestToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to acquire GitHub Actions OIDC token: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    throw new Error("GitHub Actions OIDC response did not include a token value.");
  }
  return data.value;
}

export async function runResolveDeployment(
  args: string[] = process.argv.slice(2),
  fetcher: typeof fetch = fetch
): Promise<number> {
  const host = process.env.DEVELOPER_AGENTIC_OS_HOST || process.env.NEXT_PUBLIC_APP_URL || "";
  const explicitEndpoint = process.env.DEPLOYMENT_RESOLVER_URL;
  const endpointUrl =
    explicitEndpoint || (host ? `${host.replace(/\/$/, "")}/api/hosted/deployments/resolve` : "");

  if (!endpointUrl) {
    console.error(
      "Error: No deployment resolver URL configured. Set DEVELOPER_AGENTIC_OS_HOST or DEPLOYMENT_RESOLVER_URL."
    );
    return 1;
  }

  const failOnUnconfigured = args.includes("--fail-on-unconfigured");

  let oidcToken: string;
  try {
    oidcToken = await fetchGitHubActionsOidcToken("developer-agentic-os", fetcher);
  } catch (error) {
    console.error(
      `Error acquiring OIDC token: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  try {
    console.log(`Resolving deployment target from ${endpointUrl}...`);
    const target = await resolveDeploymentWorkflowTarget({
      endpointUrl,
      oidcToken,
      fetcher,
    });

    console.log(
      `✓ Resolved deployment target: projectId=${target.projectId}${target.teamId ? ` teamId=${target.teamId}` : ""}`
    );

    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `project_id=${target.projectId}\nteam_id=${target.teamId ?? ""}\nconfigured=true\n`
      );
    }

    return 0;
  } catch (error) {
    if (error instanceof DeploymentWorkflowError && error.code === "UNCONFIGURED") {
      console.warn(
        "::warning::Deployment unconfigured: No Vercel project mapping found for this repository/tenant."
      );
      if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, "project_id=\nteam_id=\nconfigured=false\n");
      }
      if (failOnUnconfigured) {
        console.error("Failing workflow because --fail-on-unconfigured was requested.");
        return 1;
      }
      return 0;
    }

    console.error(
      `Deployment resolution failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}

// Execute if run directly
if (process.argv[1]?.endsWith("resolve-deployment.ts")) {
  runResolveDeployment()
    .then((exitCode) => {
      if (exitCode !== 0) process.exit(exitCode);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
