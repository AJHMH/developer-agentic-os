# src/server/git/local-git-adapter.ts

- LocalGitAdapter · class · L8-L62 — class LocalGitAdapter
- constructor · method · L9-L9 — constructor(private readonly root = process.cwd())
- getStatus · method · L11-L42 — async getStatus(): Promise<GitStatus>
- changedFiles · method · L44-L51 — async changedFiles(baseBranch = "main"): Promise<string[]>
- runGit · method · L53-L61 — private async runGit(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>
