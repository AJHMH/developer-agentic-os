# src/server/repo-memory/repo-memory.ts

- refreshRepoMemorySnapshot · function · L11-L26 — async function refreshRepoMemorySnapshot(root = process.cwd()): Promise<RepoMemorySnapshot>
- getRepoMemorySnapshot · function · L28-L34 — async function getRepoMemorySnapshot(root = process.cwd()): Promise<RepoMemorySnapshot>
- listAreas · function · L36-L42 — async function listAreas(root: string): Promise<string[]>
- listRepoFiles · function · L44-L48 — async function listRepoFiles(root: string): Promise<RepoMemoryFile[]>
- walk · function · L50-L65 — async function walk(current: string, output: RepoMemoryFile[], root: string): Promise<void>
- classifyFile · function · L67-L97 — function classifyFile(name: string, path: string): RepoMemoryFile["kind"]
