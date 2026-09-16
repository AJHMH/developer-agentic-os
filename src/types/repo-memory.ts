export type GitStatus = {
  available: boolean;
  currentBranch: string | null;
  recentCommits: string[];
  changedFiles: string[];
  message: string;
};

export type RepoMemoryFile = {
  path: string;
  kind: "code" | "doc" | "config" | "test" | "asset" | "other";
};

export type RepoMemorySnapshot = {
  repoName: string;
  repoPath: string;
  refreshedAt: string;
  files: RepoMemoryFile[];
  areas: string[];
  git: GitStatus;
};
