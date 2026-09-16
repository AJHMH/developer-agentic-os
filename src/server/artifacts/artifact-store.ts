import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type {
  Artifact,
  ArtifactIndexEntry,
  CreateArtifactInput,
  ListArtifactsOptions,
} from "@/types/artifact";
import { initializeLocalStore } from "../local-store/paths";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { repositoryId } from "../workspace/repository-context";

type ArtifactIndex = {
  artifacts: ArtifactIndexEntry[];
};

const emptyIndex: ArtifactIndex = { artifacts: [] };
const safeArtifactId = /^[a-f0-9-]{36}$/i;

export class ArtifactStore {
  private readonly root: string;
  private readonly repositoryRoot: string;
  private readonly repositoryContextId: string;

  constructor(root = process.cwd()) {
    this.root = resolve(root);
    this.repositoryRoot = resolve(root);
    this.repositoryContextId = repositoryId(this.repositoryRoot);
  }

  async initialize() {
    const paths = await initializeLocalStore(this.root);
    await this.readIndex();
    return paths;
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactIndexEntry> {
    const paths = await initializeLocalStore(this.root);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const artifact: Artifact = {
      id,
      name: input.name,
      type: input.type,
      content: input.content,
      tags: input.tags ?? [],
      contextRefs: input.contextRefs ?? [],
      createdAt,
      repositoryId: this.repositoryContextId,
      repositoryRoot: this.repositoryRoot,
      provenance: input.provenance ?? {
        repositoryId: this.repositoryContextId,
        repositoryRoot: this.repositoryRoot,
        workflowRefs: [],
      },
    };
    const entry = this.toIndexEntry(artifact);
    const index = await this.readIndex();

    await writeJsonFile(resolve(paths.artifacts, `${id}.json`), artifact);
    await this.writeIndex({
      artifacts: [entry, ...index.artifacts.filter((item) => item.id !== id)],
    });

    return entry;
  }

  async listArtifacts(options: ListArtifactsOptions = {}): Promise<ArtifactIndexEntry[]> {
    await initializeLocalStore(this.root);
    const index = await this.readIndex();
    const limit = options.limit ?? 50;

    return index.artifacts
      .filter((artifact) => !options.type || artifact.type === options.type)
      .filter((artifact) => !options.tag || artifact.tags.includes(options.tag))
      .slice(0, limit);
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    const paths = await initializeLocalStore(this.root);
    if (!this.isSafeArtifactId(id)) return null;

    const index = await this.readIndex();
    if (!index.artifacts.some((artifact) => artifact.id === id)) return null;

    const artifactPath = resolve(paths.artifacts, `${id}.json`);
    if (
      !artifactPath.startsWith(`${paths.artifacts}\\`) &&
      !artifactPath.startsWith(`${paths.artifacts}/`)
    )
      return null;
    if (!existsSync(artifactPath)) return null;

    return readJsonFile<Artifact | null>(artifactPath, null);
  }

  private toIndexEntry(artifact: Artifact): ArtifactIndexEntry {
    return {
      id: artifact.id,
      name: artifact.name,
      type: artifact.type,
      tags: artifact.tags,
      contextRefs: artifact.contextRefs,
      createdAt: artifact.createdAt,
      repositoryId: artifact.repositoryId,
      repositoryRoot: artifact.repositoryRoot,
      provenance: artifact.provenance,
    };
  }

  private async readIndex(): Promise<ArtifactIndex> {
    const paths = await initializeLocalStore(this.root);
    const index = await readJsonFile<ArtifactIndex>(
      resolve(paths.artifacts, "index.json"),
      emptyIndex
    );
    await this.writeIndex(index);
    return index;
  }

  private async writeIndex(index: ArtifactIndex): Promise<void> {
    const paths = await initializeLocalStore(this.root);
    await writeJsonFile(resolve(paths.artifacts, "index.json"), index);
  }

  private isSafeArtifactId(id: string): boolean {
    return safeArtifactId.test(id);
  }
}

export const artifactStore = new ArtifactStore();
