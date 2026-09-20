# src/types/github.ts

- GitHubFailureKind · type · L3-L4 — type GitHubFailureKind = "authentication" | "rate_limit" | "not_found" | "unavailable" | "invalid_response";
- GitHubFailure · type · L6-L9 — type GitHubFailure = { kind: GitHubFailureKind; message: string; };
- GitHubIssue · type · L11-L17 — type GitHubIssue = { number: number; title: string; state: string; url: string; updatedAt: string; };
- GitHubPullRequest · type · L19-L22 — type GitHubPullRequest = GitHubIssue & { draft: boolean; mergeable: "ready" | "blocked" | "unknown"; };
- GitHubActionRun · type · L24-L31 — type GitHubActionRun = { id: number; name: string; status: string; conclusion: string | null; url: string; createdAt: string; };
- GitHubMergeStatus · type · L33-L36 — type GitHubMergeStatus = { state: "ready" | "blocked" | "unavailable"; message: string; };
- GitHubOperations · type · L38-L48 — type GitHubOperations = { status: IntegrationStatus; repository: string | null; message: string; issues: GitHubIssue[]; pullRequests: GitHubPullRequest[]; actions: GitHubActionRun[]; mergeStatus: GitHubMergeStatus; failure: GitHubFailure | null; checkedAt: string; };
