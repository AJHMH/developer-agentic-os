import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { platform } from "node:process";

import type { RepositoryContext, Workspace } from "@/types/workspace";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { getLocalStorePaths, initializeLocalStore } from "../local-store/paths";

const emptyWorkspace: Workspace = { repositories: [], activeRepositoryId: null };

export class WorkspaceError extends Error {
  constructor(
    readonly code: "INVALID_PATH" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export class WorkspaceStore {
  constructor(private readonly root = process.cwd()) {}

  async listRepositories(): Promise<RepositoryContext[]> {
    const workspace = await this.readWorkspace();
    return workspace.repositories;
  }

  async getActiveContext(): Promise<RepositoryContext> {
    const workspace = await this.readWorkspace();
    const active = workspace.repositories.find(
      (repository) => repository.id === workspace.activeRepositoryId
    );
    return active ?? defaultContext(this.root);
  }

  async getContext(id: string): Promise<RepositoryContext> {
    const workspace = await this.readWorkspace();
    const context = workspace.repositories.find((repository) => repository.id === id);
    if (!context) throw new WorkspaceError("NOT_FOUND", "Repository context not found.");
    return context;
  }

  async registerRepository(inputPath: string): Promise<RepositoryContext> {
    const repository = await repositoryFromPath(inputPath);
    const workspace = await this.readWorkspace();
    const existing = workspace.repositories.find((item) => item.id === repository.id);
    if (existing) return existing;

    await this.writeWorkspace({
      repositories: [...workspace.repositories, repository],
      activeRepositoryId: workspace.activeRepositoryId ?? repository.id,
    });
    return repository;
  }

  async removeRepository(id: string): Promise<void> {
    const workspace = await this.readWorkspace();
    if (!workspace.repositories.some((repository) => repository.id === id)) {
      throw new WorkspaceError("NOT_FOUND", "Repository context not found.");
    }

    const repositories = workspace.repositories.filter((repository) => repository.id !== id);
    await this.writeWorkspace({
      repositories,
      activeRepositoryId:
        workspace.activeRepositoryId === id
          ? (repositories[0]?.id ?? null)
          : workspace.activeRepositoryId,
    });
  }

  async setActiveContext(id: string): Promise<RepositoryContext> {
    const workspace = await this.readWorkspace();
    const active = workspace.repositories.find((repository) => repository.id === id);
    if (!active) throw new WorkspaceError("NOT_FOUND", "Repository context not found.");

    await this.writeWorkspace({ ...workspace, activeRepositoryId: id });
    return active;
  }

  private async readWorkspace(): Promise<Workspace> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<Workspace>(paths.workspace, emptyWorkspace);
  }

  private async writeWorkspace(workspace: Workspace): Promise<void> {
    const paths = getLocalStorePaths(this.root);
    await writeJsonFile(paths.workspace, workspace);
  }
}

export const workspaceStore = new WorkspaceStore();

async function repositoryFromPath(inputPath: string): Promise<RepositoryContext> {
  if (!inputPath?.trim())
    throw new WorkspaceError("INVALID_PATH", "A repository path is required.");

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(resolve(inputPath));
  } catch {
    throw new WorkspaceError("INVALID_PATH", "Repository path does not exist.");
  }

  if (!(await stat(resolvedPath)).isDirectory()) {
    throw new WorkspaceError("INVALID_PATH", "Repository path must be a directory.");
  }

  return { id: repositoryId(resolvedPath), name: basename(resolvedPath), path: resolvedPath };
}

function defaultContext(root: string): RepositoryContext {
  const resolvedPath = resolve(root);
  return { id: repositoryId(resolvedPath), name: basename(resolvedPath), path: resolvedPath };
}

function repositoryId(path: string): string {
  const normalized = platform === "win32" ? path.toLowerCase() : path;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}
