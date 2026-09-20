# src/server/workspace/workspace-store.ts

- WorkspaceError · class · L12-L20 — class WorkspaceError extends Error
- constructor · method · L13-L19 — constructor( readonly code: "INVALID_PATH" | "NOT_FOUND", message: string )
- WorkspaceStore · class · L22-L92 — class WorkspaceStore
- constructor · method · L23-L23 — constructor(private readonly root = process.cwd())
- listRepositories · method · L25-L28 — async listRepositories(): Promise<RepositoryContext[]>
- getActiveContext · method · L30-L36 — async getActiveContext(): Promise<RepositoryContext>
- getContext · method · L38-L43 — async getContext(id: string): Promise<RepositoryContext>
- registerRepository · method · L45-L56 — async registerRepository(inputPath: string): Promise<RepositoryContext>
- removeRepository · method · L58-L72 — async removeRepository(id: string): Promise<void>
- setActiveContext · method · L74-L81 — async setActiveContext(id: string): Promise<RepositoryContext>
- readWorkspace · method · L83-L86 — private async readWorkspace(): Promise<Workspace>
- writeWorkspace · method · L88-L91 — private async writeWorkspace(workspace: Workspace): Promise<void>
- repositoryFromPath · function · L96-L116 — async function repositoryFromPath(inputPath: string): Promise<RepositoryContext>
- defaultContext · function · L118-L125 — function defaultContext(root: string): RepositoryContext
- repositoryNameFromPath · function · L127-L134 — function repositoryNameFromPath(path: string): string
- repositoryId · function · L136-L139 — function repositoryId(path: string): string
