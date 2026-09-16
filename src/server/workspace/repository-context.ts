import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { platform } from "node:process";

import type { RepositoryContext } from "@/types/workspace";
import { WorkspaceError, workspaceStore } from "./workspace-store";

export type RepositoryContextInput = {
  repositoryId?: unknown;
  contextId?: unknown;
  repositoryRoot?: unknown;
  root?: unknown;
};

export async function resolveRepositoryContext(
  input: RepositoryContextInput = {}
): Promise<RepositoryContext> {
  const id =
    typeof input.repositoryId === "string"
      ? input.repositoryId
      : typeof input.contextId === "string"
        ? input.contextId
        : undefined;
  const root =
    typeof input.repositoryRoot === "string"
      ? input.repositoryRoot
      : typeof input.root === "string"
        ? input.root
        : undefined;

  if (id) {
    try {
      const context = await workspaceStore.getContext(id);
      if (root && resolve(root) !== resolve(context.path))
        throw new WorkspaceError("INVALID_PATH", "Repository context root does not match its id.");
      return context;
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "NOT_FOUND") throw error;
      const repositories = await workspaceStore.listRepositories();
      const fallback = await workspaceStore.getActiveContext();
      if (repositories.length !== 0 || fallback.id !== id) throw error;
      return fallback;
    }
  }
  if (root) {
    const repositories = await workspaceStore.listRepositories();
    const fallback = await workspaceStore.getActiveContext();
    const allKnown = [fallback, ...repositories];
    const resolvedInput = resolve(root);
    const registered = allKnown.find(
      (repository) =>
        resolve(repository.path) === resolvedInput || repository.id === repositoryId(resolvedInput)
    );
    if (registered) return registered;
    throw new WorkspaceError(
      "NOT_FOUND",
      "Repository context must be registered before it can be used."
    );
  }
  return workspaceStore.getActiveContext();
}

export async function contextFromRoot(inputRoot: string): Promise<RepositoryContext> {
  if (!inputRoot || typeof inputRoot !== "string" || !inputRoot.trim())
    throw new WorkspaceError("INVALID_PATH", "Repository context root is required.");
  const normalized = resolve(inputRoot);
  let path: string;
  try {
    path = await realpath(normalized);
    if (!(await stat(path)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new WorkspaceError("INVALID_PATH", "Repository context root does not exist.");
  }
  return { id: repositoryId(path), name: path.split(/[\\/]/).at(-1) ?? path, path };
}

export function repositoryId(root: string): string {
  const normalized = platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}
