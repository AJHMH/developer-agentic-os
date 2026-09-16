import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type {
  CreateHandoffInput,
  Handoff,
  HandoffSnapshot,
  UpdateHandoffInput,
} from "@/types/handoff";
import type { RepositoryContext, WorkspaceContext } from "@/types/workspace";
import { ArtifactStore } from "../artifacts/artifact-store";
import { refreshRepoMemorySnapshot } from "../repo-memory/repo-memory";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import { initializeLocalStore } from "../local-store/paths";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { WorkItemStore } from "../work-items/work-item-store";

type HandoffIndex = { handoffs: Handoff[] };
const emptyIndex: HandoffIndex = { handoffs: [] };

export class HandoffError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "FINALIZED",
    message: string
  ) {
    super(message);
    this.name = "HandoffError";
  }
}

/**
 * HandoffStore with optional dependency injection.
 * Accepts WorkspaceContext for DI; creates stores from root if not provided.
 */
export class HandoffStore {
  constructor(
    private readonly root = process.cwd(),
    private readonly context?: WorkspaceContext
  ) {}

  async list(repositoryId?: string): Promise<Handoff[]> {
    const index = await this.readIndex();
    return index.handoffs
      .filter((handoff) => !repositoryId || handoff.snapshot.repositoryContext.id === repositoryId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string, repositoryId?: string): Promise<Handoff> {
    const handoff = (await this.readIndex()).handoffs.find((item) => item.id === id);
    if (!handoff || (repositoryId && handoff.snapshot.repositoryContext.id !== repositoryId))
      throw new HandoffError("NOT_FOUND", "Handoff not found.");
    return handoff;
  }

  async create(context: RepositoryContext, input: CreateHandoffInput = {}): Promise<Handoff> {
    validateInput(input);
    const repoMemory = await refreshRepoMemorySnapshot(context.path);
    const artifactStore = this.context?.artifactStore ?? new ArtifactStore(context.path);
    const snapshot: HandoffSnapshot = {
      repositoryContext: context,
      branch: repoMemory.git.currentBranch,
      changedFiles: [...repoMemory.git.changedFiles],
      workItems: await (this.context?.workItemStore ?? new WorkItemStore(context.path)).list({
        repositoryId: context.id,
      }),
      artifacts: await artifactStore.listArtifacts({ limit: 100 }),
      skillRuns: await (this.context?.skillRunStore ?? new SkillRunStore(context.path)).listRuns({
        limit: 100,
      }),
      repoMemory,
    };
    const now = new Date().toISOString();
    const handoff: Handoff = {
      id: randomUUID(),
      title: input.title?.trim() || `Session Handoff - ${context.name}`,
      status: "draft",
      snapshot,
      decisions: cleanLines(input.decisions),
      blockers: cleanLines(input.blockers),
      nextActions: cleanLines(input.nextActions),
      createdAt: now,
      updatedAt: now,
      finalizedAt: null,
      artifactId: null,
    };
    await this.save(handoff);
    return handoff;
  }

  async update(id: string, input: UpdateHandoffInput, repositoryId?: string): Promise<Handoff> {
    validateInput(input);
    const current = await this.get(id, repositoryId);
    if (current.status === "finalized")
      throw new HandoffError("FINALIZED", "Finalized handoffs are immutable.");
    const updated: Handoff = {
      ...current,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.decisions !== undefined ? { decisions: cleanLines(input.decisions) } : {}),
      ...(input.blockers !== undefined ? { blockers: cleanLines(input.blockers) } : {}),
      ...(input.nextActions !== undefined ? { nextActions: cleanLines(input.nextActions) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async finalize(id: string, repositoryId?: string): Promise<Handoff> {
    const current = await this.get(id, repositoryId);
    if (current.status === "finalized") return current;
    const finalizedAt = new Date().toISOString();
    const finalized: Handoff = {
      ...current,
      status: "finalized",
      finalizedAt,
      updatedAt: finalizedAt,
    };
    const artifact = await (
      this.context?.artifactStore ?? new ArtifactStore(current.snapshot.repositoryContext.path)
    ).createArtifact({
      name: current.title,
      type: "session_handoff",
      content: finalized,
      tags: ["handoff", "immutable"],
      contextRefs: [
        { kind: "repo_context", ref: current.snapshot.repositoryContext.id },
        ...current.snapshot.workItems.map((item) => ({ kind: "work_item" as const, ref: item.id })),
      ],
      provenance: {
        repositoryId: current.snapshot.repositoryContext.id,
        repositoryRoot: current.snapshot.repositoryContext.path,
        workflowRefs: current.snapshot.skillRuns.map((run) => ({
          kind: "skill" as const,
          ref: run.skillId,
          label: run.skillId,
        })),
      },
    });
    const completed: Handoff = { ...finalized, artifactId: artifact.id };
    await this.save(completed);
    return completed;
  }

  private async save(handoff: Handoff): Promise<void> {
    const paths = await initializeLocalStore(this.root);
    const index = await this.readIndex();
    await writeJsonFile(resolve(paths.handoffs, `${handoff.id}.json`), handoff);
    await writeJsonFile(resolve(paths.handoffs, "index.json"), {
      handoffs: [handoff, ...index.handoffs.filter((item) => item.id !== handoff.id)],
    });
  }

  private async readIndex(): Promise<HandoffIndex> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<HandoffIndex>(resolve(paths.handoffs, "index.json"), emptyIndex);
  }
}

export const handoffStore = new HandoffStore();

function validateInput(input: CreateHandoffInput | UpdateHandoffInput): void {
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim()))
    throw new HandoffError("INVALID_INPUT", "title must be a non-empty string");
  for (const field of ["decisions", "blockers", "nextActions"] as const) {
    if (
      input[field] !== undefined &&
      (!Array.isArray(input[field]) || input[field].some((line) => typeof line !== "string"))
    )
      throw new HandoffError("INVALID_INPUT", `${field} must be an array of strings`);
  }
}

function cleanLines(lines: string[] | undefined): string[] {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}
