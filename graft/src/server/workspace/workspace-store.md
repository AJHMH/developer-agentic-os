# src/server/workspace/workspace-store.ts

- WorkspaceError · class · L12-L20 — class WorkspaceError extends Error
- constructor · method · L13-L19 — constructor( readonly code: "INVALID_PATH" | "NOT_FOUND", message: string )
- WorkspaceStore · class · L22-L104 — class WorkspaceStore
- constructor · method · L23-L23 — constructor(private readonly root = process.cwd())
- listRepositories · method · L25-L28 — async listRepositories(): Promise<RepositoryContext[]>
- getActiveContext · method · L30-L43 — async getActiveContext(): Promise<RepositoryContext>
- getContext · method · L45-L50 — async getContext(id: string): Promise<RepositoryContext>
- registerRepository · method · L52-L68 — async registerRepository(inputPath: string, makeActive?: boolean): Promise<RepositoryContext>
- removeRepository · method · L70-L84 — async removeRepository(id: string): Promise<void>
- setActiveContext · method · L86-L93 — async setActiveContext(id: string): Promise<RepositoryContext>
- readWorkspace · method · L95-L98 — private async readWorkspace(): Promise<Workspace>
- writeWorkspace · method · L100-L103 — private async writeWorkspace(workspace: Workspace): Promise<void>
- repositoryFromPath · function · L108-L128 — async function repositoryFromPath(inputPath: string): Promise<RepositoryContext>
- defaultContext · function · L130-L137 — function defaultContext(root: string): RepositoryContext
- repositoryNameFromPath · function · L139-L146 — function repositoryNameFromPath(path: string): string
- repositoryId · function · L148-L151 — function repositoryId(path: string): string
