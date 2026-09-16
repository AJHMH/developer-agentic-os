import { LocalGitAdapter } from "../git/local-git-adapter";
import { getRepoMemorySnapshot, refreshRepoMemorySnapshot } from "../repo-memory/repo-memory";
import type { SkillHandlerResult } from "@/types/skill";

export type SkillHandler = (input: Record<string, string>) => Promise<SkillHandlerResult>;

/**
 * Creates a map of skill ID → handler function.
 * Handlers are pure functions that take input and produce artifact results.
 * This module is independently testable by providing mock dependencies.
 */
export function createSkillHandlers(root: string): Record<string, SkillHandler> {
  return {
    "repo-summary": async () => {
      const snapshot = await refreshRepoMemorySnapshot(root);
      return artifact(
        "Repo Summary",
        "repo_summary",
        {
          repoName: snapshot.repoName,
          fileCount: snapshot.files.length,
          areas: snapshot.areas,
          git: snapshot.git,
        },
        ["repo-summary"]
      );
    },

    "branch-summary": async (input) => {
      requireInput(input, "baseBranch", "Base branch is required.");
      requireInput(input, "targetBranch", "Target branch is required.");
      const git = new LocalGitAdapter(root);
      const changedFiles = await git.changedFiles(input.baseBranch);
      const status = await git.getStatus();
      return artifact(
        "Branch Summary",
        "branch_summary",
        {
          baseBranch: input.baseBranch,
          targetBranch: input.targetBranch,
          currentBranch: status.currentBranch,
          changedFiles,
          summary: `Branch ${input.targetBranch} has ${changedFiles.length} changed file(s) against ${input.baseBranch}.`,
        },
        ["branch-summary"]
      );
    },

    "release-readiness": async () => {
      const snapshot = await getRepoMemorySnapshot(root);
      const blockers = snapshot.git.available ? [] : ["Local git is unavailable."];
      if (snapshot.git.changedFiles.length === 0) blockers.push("No changed files detected.");
      const score = Math.max(0, 100 - blockers.length * 25);
      return artifact(
        "Release Readiness",
        "release_readiness",
        {
          repoName: snapshot.repoName,
          score,
          status: blockers.length ? "watch" : "ready",
          blockers,
          changedFiles: snapshot.git.changedFiles,
        },
        ["release-readiness"]
      );
    },

    "implementation-checklist": async (input) => {
      requireInput(input, "workItem", "Work item text is required.");
      return artifact(
        "Implementation Checklist",
        "implementation_checklist",
        {
          workItem: input.workItem,
          checklist: [
            "Map the likely implementation surface.",
            "Write or update behavior tests.",
            "Implement the smallest vertical slice.",
            "Run lint, typecheck, tests, and build.",
          ],
        },
        ["implementation-checklist"]
      );
    },

    "sprint-digest": async () => {
      const snapshot = await getRepoMemorySnapshot(root);
      return artifact(
        "Sprint Digest",
        "sprint_digest",
        {
          repoName: snapshot.repoName,
          recentCommits: snapshot.git.recentCommits,
          changedFiles: snapshot.git.changedFiles,
          summary: `${snapshot.repoName} has ${snapshot.git.changedFiles.length} changed file(s) and ${snapshot.git.recentCommits.length} recent commit(s).`,
        },
        ["sprint-digest"]
      );
    },
  };
}

// Helper functions
export function artifact(
  name: string,
  type: string,
  content: SkillHandlerResult["content"],
  tags: string[]
): SkillHandlerResult {
  return { name, type, content, tags };
}

export function requireInput(input: Record<string, string>, key: string, message: string): void {
  if (!input[key]?.trim()) throw new Error(message);
}
