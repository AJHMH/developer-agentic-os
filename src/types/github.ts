import type { IntegrationStatus } from "./integration";

export type GitHubFailureKind =
  "authentication" | "rate_limit" | "not_found" | "unavailable" | "invalid_response";

export type GitHubFailure = {
  kind: GitHubFailureKind;
  message: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  state: string;
  url: string;
  updatedAt: string;
};

export type GitHubPullRequest = GitHubIssue & {
  draft: boolean;
  mergeable: "ready" | "blocked" | "unknown";
};

export type GitHubActionRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
};

export type GitHubMergeStatus = {
  state: "ready" | "blocked" | "unavailable";
  message: string;
};

export type GitHubOperations = {
  status: IntegrationStatus;
  repository: string | null;
  message: string;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  actions: GitHubActionRun[];
  mergeStatus: GitHubMergeStatus;
  failure: GitHubFailure | null;
  checkedAt: string;
};
