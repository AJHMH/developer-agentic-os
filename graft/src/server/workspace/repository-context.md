# src/server/workspace/repository-context.ts

- RepositoryContextInput · type · L9-L14 — type RepositoryContextInput = { repositoryId?: unknown; contextId?: unknown; repositoryRoot?: unknown; root?: unknown; };
- resolveRepositoryContext · function · L16-L62 — async function resolveRepositoryContext( input: RepositoryContextInput = {} ): Promise<RepositoryContext>
- normalizePath · function · L64-L71 — async function normalizePath(inputPath: string): Promise<string>
- contextFromRoot · function · L73-L85 — async function contextFromRoot(inputRoot: string): Promise<RepositoryContext>
- repositoryId · function · L87-L90 — function repositoryId(root: string): string
