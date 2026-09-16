import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GitStatus } from "@/types/repo-memory";

const execFileAsync = promisify(execFile);

export class LocalGitAdapter {
  constructor(private readonly root = process.cwd()) {}

  async getStatus(): Promise<GitStatus> {
    const insideWorkTree = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
    if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
      return {
        available: false,
        currentBranch: null,
        recentCommits: [],
        changedFiles: [],
        message: "Workspace is not a git checkout.",
      };
    }

    const [branch, commits, changedFiles] = await Promise.all([
      this.runGit(["branch", "--show-current"]),
      this.runGit(["log", "--oneline", "-n", "5"]),
      this.runGit(["status", "--short"]),
    ]);

    return {
      available: true,
      currentBranch: branch.stdout.trim() || "HEAD",
      recentCommits: commits.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      changedFiles: changedFiles.stdout
        .split(/\r?\n/)
        .map((line) => line.slice(3).trim())
        .filter(Boolean),
      message: "Local git is connected.",
    };
  }

  async changedFiles(baseBranch = "main"): Promise<string[]> {
    const diff = await this.runGit(["diff", "--name-only", baseBranch, "HEAD"]);
    if (!diff.ok) return (await this.getStatus()).changedFiles;
    return diff.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async runGit(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, { cwd: this.root });
      return { ok: true, stdout, stderr };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      return { ok: false, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
  }
}
