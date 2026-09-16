import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { VercelDeployment, VercelFailure, VercelOperations } from "@/types/vercel";

type VercelFetch = (input: string, init?: RequestInit) => Promise<Response>;
type VercelApiDeployment = {
  uid?: unknown;
  name?: unknown;
  url?: unknown;
  state?: unknown;
  created?: unknown;
  target?: unknown;
};

export class VercelAdapter {
  private readonly token: string | undefined;
  private readonly projectId: string | null;
  private readonly teamId: string | undefined;
  private readonly apiUrl: string;
  private readonly fetcher: VercelFetch;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    fetcher: VercelFetch = fetch as VercelFetch,
    private readonly repositoryRoot?: string
  ) {
    this.token = env.VERCEL_TOKEN || env.VERCEL_API_TOKEN;
    this.projectId = env.VERCEL_PROJECT_ID || null;
    this.teamId = env.VERCEL_TEAM_ID;
    this.apiUrl = (env.VERCEL_API_URL || "https://api.vercel.com").replace(/\/$/, "");
    this.fetcher = fetcher;
  }

  async getOperations(): Promise<VercelOperations> {
    if (!this.token)
      return this.empty(
        "unconfigured",
        "Vercel credentials are not configured. Set VERCEL_TOKEN or VERCEL_API_TOKEN."
      );
    const project = await this.projectForContext();
    if (!project.id)
      return this.empty(
        "unconfigured",
        "Set VERCEL_PROJECT_ID or link this Repository Context with Vercel."
      );

    try {
      const query = new URLSearchParams({ projectId: project.id, limit: "10" });
      if (project.teamId) query.set("teamId", project.teamId);
      const payload = await this.request<{ deployments?: VercelApiDeployment[] }>(
        `/v6/deployments?${query}`
      );
      const deployments = (payload.deployments ?? []).map((deployment) =>
        toDeployment(deployment, project.id as string)
      );
      const failedDeployment = deployments.find((deployment) => deployment.state === "error");
      return {
        status: failedDeployment ? "unhealthy" : "healthy",
        projectId: project.id,
        message: failedDeployment
          ? `Vercel deployment ${failedDeployment.name} failed.`
          : "Vercel operations are available.",
        deployments,
        failure: failedDeployment
          ? {
              kind: "unavailable",
              message: `Deployment ${failedDeployment.name} reported an error.`,
            }
          : null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const failure =
        error instanceof VercelRequestError
          ? error.failure
          : {
              kind: "unavailable" as const,
              message: error instanceof Error ? error.message : "Vercel could not be reached.",
            };
      return { ...this.empty("unhealthy", failure.message), projectId: this.projectId, failure };
    }
  }

  async redeploy(
    deploymentId: string,
    expectedProjectId?: string
  ): Promise<{ ok: boolean; status: number; response: Record<string, unknown> }> {
    if (!this.token)
      return {
        ok: false,
        status: 401,
        response: { error: "Vercel credentials are not configured." },
      };
    if (!deploymentId.trim())
      return { ok: false, status: 400, response: { error: "A deployment id is required." } };
    if (!expectedProjectId?.trim())
      return {
        ok: false,
        status: 400,
        response: { error: "An expected Vercel project id is required." },
      };
    const project = await this.projectForContext();
    if (!project.id || expectedProjectId !== project.id)
      return {
        ok: false,
        status: 409,
        response: { error: "Deployment is outside the expected Vercel project." },
      };
    const response = await this.fetcher(
      `${this.apiUrl}/v13/deployments/${encodeURIComponent(deploymentId)}/redeploy`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      }
    );
    return {
      ok: response.ok,
      status: response.status,
      response: {
        provider: "vercel",
        deploymentId,
        projectId: expectedProjectId,
        status: response.status,
        body: await responseBody(response),
      },
    };
  }

  private async projectForContext(): Promise<{ id: string | null; teamId: string | undefined }> {
    if (!this.repositoryRoot) return { id: this.projectId, teamId: this.teamId };
    try {
      const file = await readFile(join(this.repositoryRoot, ".vercel", "project.json"), "utf8");
      const parsed = JSON.parse(file) as { projectId?: unknown; orgId?: unknown };
      return {
        id: typeof parsed.projectId === "string" ? parsed.projectId : this.projectId,
        teamId: typeof parsed.orgId === "string" ? parsed.orgId : this.teamId,
      };
    } catch {
      return { id: this.projectId, teamId: this.teamId };
    }
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      });
    } catch {
      throw new VercelRequestError({
        kind: "timeout",
        message: "Vercel request timed out or could not be reached.",
      });
    }
    if (!response.ok) throw new VercelRequestError(failureForResponse(response));
    try {
      return (await response.json()) as T;
    } catch {
      throw new VercelRequestError({
        kind: "invalid_response",
        message: "Vercel returned an invalid response.",
      });
    }
  }

  private empty(status: VercelOperations["status"], message: string): VercelOperations {
    return {
      status,
      projectId: this.projectId,
      message,
      deployments: [],
      failure: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return await response.clone().text();
  }
}

class VercelRequestError extends Error {
  constructor(readonly failure: VercelFailure) {
    super(failure.message);
  }
}

function failureForResponse(response: Response): VercelFailure {
  if (response.status === 401 || response.status === 403)
    return { kind: "authentication", message: "Vercel credentials were rejected." };
  if (response.status === 429)
    return { kind: "rate_limit", message: "Vercel API rate limit has been reached." };
  if (response.status === 404)
    return {
      kind: "not_found",
      message: "The configured Vercel project was not found or is not accessible.",
    };
  return { kind: "unavailable", message: `Vercel returned HTTP ${response.status}.` };
}

function toDeployment(deployment: VercelApiDeployment, projectId: string): VercelDeployment {
  const id = typeof deployment.uid === "string" ? deployment.uid : "unknown";
  const state = deploymentState(deployment.state);
  return {
    id,
    name: typeof deployment.name === "string" ? deployment.name : "Unnamed deployment",
    url: typeof deployment.url === "string" ? `https://${deployment.url}` : "",
    state,
    target: typeof deployment.target === "string" ? deployment.target : null,
    createdAt:
      typeof deployment.created === "number" ? new Date(deployment.created).toISOString() : "",
    buildLogUrl: `https://vercel.com/deployments/${id}`,
    runtimeLogUrl: `https://vercel.com/${projectId}/logs`,
  };
}

function deploymentState(value: unknown): VercelDeployment["state"] {
  if (value === "READY") return "ready";
  if (value === "BUILDING") return "building";
  if (value === "ERROR") return "error";
  if (value === "QUEUED") return "queued";
  return "unknown";
}
