import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitHubActionRun,
  GitHubFailure,
  GitHubIssue,
  GitHubMergeStatus,
  GitHubOperations,
  GitHubPullRequest,
} from "@/types/github";

const defaultApiUrl = "https://api.github.com";
const execFileAsync = promisify(execFile);
type GitHubFetch = (input: string, init?: RequestInit) => Promise<Response>;

type GitHubApiIssue = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  html_url?: unknown;
  updated_at?: unknown;
  pull_request?: unknown;
  draft?: unknown;
  mergeable?: unknown;
};

type GitHubApiActionRun = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
  created_at?: unknown;
};

export class GitHubAdapter {
  private readonly token: string | undefined;
  private readonly repository: string | null;
  private readonly apiUrl: string;
  private readonly fetcher: GitHubFetch;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    fetcher: GitHubFetch = fetch as GitHubFetch,
    private readonly repositoryRoot?: string
  ) {
    this.token = env.GITHUB_TOKEN || env.GH_TOKEN;
    this.repository = normalizeRepository(
      env.GITHUB_REPOSITORY || joinRepositoryParts(env.GITHUB_OWNER, env.GITHUB_REPO)
    );
    this.apiUrl = (env.GITHUB_API_URL || defaultApiUrl).replace(/\/$/, "");
    this.fetcher = fetcher;
  }

  async getOperations(): Promise<GitHubOperations> {
    if (!this.token)
      return this.empty(
        "unconfigured",
        "GitHub credentials are not configured. Set GITHUB_TOKEN or GH_TOKEN."
      );
    const repository = await this.repositoryForContext();
    if (!repository)
      return this.empty(
        "unconfigured",
        "Set GITHUB_REPOSITORY or configure a GitHub origin for this Repository Context."
      );

    try {
      const [issuesPayload, pullRequestsPayload, actionsPayload] = await Promise.all([
        this.request<GitHubApiIssue[]>(`/repos/${repository}/issues?state=open&per_page=20`),
        this.request<GitHubApiIssue[]>(`/repos/${repository}/pulls?state=open&per_page=20`),
        this.request<{ workflow_runs?: GitHubApiActionRun[] }>(
          `/repos/${repository}/actions/runs?per_page=20`
        ),
      ]);
      const issues = issuesPayload.filter((issue) => !issue.pull_request).map(toIssue);
      const pullRequests = pullRequestsPayload.map(toPullRequest);
      const actions = (actionsPayload.workflow_runs ?? []).map(toAction);
      return {
        status: "healthy",
        repository,
        message: "GitHub operations are available.",
        issues,
        pullRequests,
        actions,
        mergeStatus: mergeStatusFor(pullRequests),
        failure: null,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const failure =
        error instanceof GitHubRequestError
          ? error.failure
          : {
              kind: "unavailable" as const,
              message: error instanceof Error ? error.message : "GitHub could not be reached.",
            };
      return {
        ...this.empty("unhealthy", failure.message),
        repository,
        failure,
      };
    }
  }

  async rerunFailedAction(
    runId: string
  ): Promise<{ ok: boolean; status: number; response: Record<string, unknown> }> {
    if (!this.token)
      return {
        ok: false,
        status: 401,
        response: { error: "GitHub credentials are not configured." },
      };
    const repository = await this.repositoryForContext();
    if (!repository || !/^\d+$/.test(runId))
      return {
        ok: false,
        status: 400,
        response: { error: "A valid repository and action run id are required." },
      };
    const response = await this.fetcher(
      `${this.apiUrl}/repos/${repository}/actions/runs/${runId}/rerun-failed`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    return {
      ok: response.ok,
      status: response.status,
      response: {
        provider: "github",
        runId,
        status: response.status,
        body: await responseBody(response),
      },
    };
  }

  private async repositoryForContext(): Promise<string | null> {
    if (!this.repositoryRoot) return this.repository;
    try {
      const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
        cwd: this.repositoryRoot,
      });
      return normalizeRepository(stdout.trim()) ?? this.repository;
    } catch {
      return this.repository;
    }
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiUrl}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch {
      throw new GitHubRequestError({
        kind: "unavailable",
        message: "GitHub could not be reached.",
      });
    }

    if (!response.ok) throw new GitHubRequestError(failureForResponse(response));
    try {
      return (await response.json()) as T;
    } catch {
      throw new GitHubRequestError({
        kind: "invalid_response",
        message: "GitHub returned an invalid response.",
      });
    }
  }

  private empty(status: GitHubOperations["status"], message: string): GitHubOperations {
    return {
      status,
      repository: this.repository,
      message,
      issues: [],
      pullRequests: [],
      actions: [],
      mergeStatus: { state: "unavailable", message: "Merge status is unavailable." },
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

class GitHubRequestError extends Error {
  constructor(readonly failure: GitHubFailure) {
    super(failure.message);
  }
}

function failureForResponse(response: Response): GitHubFailure {
  if (response.status === 401)
    return { kind: "authentication", message: "GitHub credentials were rejected." };
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  )
    return { kind: "rate_limit", message: "GitHub API rate limit has been reached." };
  if (response.status === 404)
    return {
      kind: "not_found",
      message: "The configured GitHub repository was not found or is not accessible.",
    };
  return { kind: "unavailable", message: `GitHub returned HTTP ${response.status}.` };
}

function normalizeRepository(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  return parts.length === 2 && parts.every((part) => /^[\w.-]+$/.test(part))
    ? `${parts[0]}/${parts[1]}`
    : null;
}

function joinRepositoryParts(
  owner: string | undefined,
  repo: string | undefined
): string | undefined {
  return owner && repo ? `${owner}/${repo}` : undefined;
}

function toIssue(issue: GitHubApiIssue): GitHubIssue {
  return {
    number: numberValue(issue.number),
    title: stringValue(issue.title, "Untitled issue"),
    state: stringValue(issue.state, "unknown"),
    url: stringValue(issue.html_url, ""),
    updatedAt: stringValue(issue.updated_at, ""),
  };
}

function toPullRequest(pullRequest: GitHubApiIssue): GitHubPullRequest {
  return {
    ...toIssue(pullRequest),
    draft: pullRequest.draft === true,
    mergeable:
      pullRequest.mergeable === true
        ? "ready"
        : pullRequest.mergeable === false
          ? "blocked"
          : "unknown",
  };
}

function toAction(action: GitHubApiActionRun): GitHubActionRun {
  return {
    id: numberValue(action.id),
    name: stringValue(action.name, "Unnamed workflow"),
    status: stringValue(action.status, "unknown"),
    conclusion: typeof action.conclusion === "string" ? action.conclusion : null,
    url: stringValue(action.html_url, ""),
    createdAt: stringValue(action.created_at, ""),
  };
}

function mergeStatusFor(pullRequests: GitHubPullRequest[]): GitHubMergeStatus {
  if (pullRequests.some((pullRequest) => pullRequest.mergeable === "blocked"))
    return { state: "blocked", message: "At least one open pull request is blocked." };
  if (
    pullRequests.length > 0 &&
    pullRequests.every((pullRequest) => pullRequest.mergeable === "ready")
  )
    return { state: "ready", message: "All open pull requests are mergeable." };
  return {
    state: "unavailable",
    message: "GitHub has not reported mergeability for the open pull requests.",
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
