import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { RoutineExecutionRecord, RoutineStatus } from "@/types/routine";
import { initializeLocalStore } from "../local-store/paths";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { repositoryId } from "../workspace/repository-context";

type RoutineHistory = {
  executions: RoutineExecutionRecord[];
  pausedRoutineIds: string[];
};

const emptyHistory: RoutineHistory = { executions: [], pausedRoutineIds: [] };

export class RoutineHistoryStore {
  private readonly repositoryRoot: string;
  private readonly repositoryContextId: string;

  constructor(private readonly root = process.cwd()) {
    this.repositoryRoot = resolve(root);
    this.repositoryContextId = repositoryId(this.repositoryRoot);
  }

  async createExecution(
    routineId: string,
    options: { source?: RoutineExecutionRecord["source"]; startedAt?: string } = {}
  ): Promise<RoutineExecutionRecord> {
    const execution: RoutineExecutionRecord = {
      id: randomUUID(),
      routineId,
      status: "running",
      startedAt: options.startedAt ?? new Date().toISOString(),
      completedAt: null,
      artifactIds: [],
      skillRunId: null,
      error: null,
      source: options.source ?? "manual",
      repositoryId: this.repositoryContextId,
      repositoryRoot: this.repositoryRoot,
    };
    await this.saveExecution(execution);
    return execution;
  }

  async completeExecution(
    execution: RoutineExecutionRecord,
    update: {
      status: RoutineStatus;
      artifactIds?: string[];
      skillRunId?: string | null;
      error?: string | null;
      completedAt?: string;
    }
  ): Promise<RoutineExecutionRecord> {
    const completed: RoutineExecutionRecord = {
      ...execution,
      status: update.status,
      artifactIds: update.artifactIds ?? execution.artifactIds,
      skillRunId: update.skillRunId ?? execution.skillRunId,
      error: update.error ?? null,
      completedAt: update.completedAt ?? new Date().toISOString(),
    };
    await this.saveExecution(completed);
    return completed;
  }

  async listExecutions({
    limit = 50,
    routineId,
  }: { limit?: number; routineId?: string } = {}): Promise<RoutineExecutionRecord[]> {
    const history = await this.readHistory();
    return history.executions
      .filter((execution) => !routineId || execution.routineId === routineId)
      .slice(0, limit);
  }

  async pauseRoutine(routineId: string): Promise<void> {
    const history = await this.readHistory();
    await this.writeHistory({
      ...history,
      pausedRoutineIds: Array.from(new Set([...history.pausedRoutineIds, routineId])),
    });
  }

  async resumeRoutine(routineId: string): Promise<void> {
    const history = await this.readHistory();
    await this.writeHistory({
      ...history,
      pausedRoutineIds: history.pausedRoutineIds.filter((id) => id !== routineId),
    });
  }

  async isPaused(routineId: string): Promise<boolean> {
    return (await this.readHistory()).pausedRoutineIds.includes(routineId);
  }

  private async saveExecution(execution: RoutineExecutionRecord): Promise<void> {
    const history = await this.readHistory();
    await this.writeHistory({
      ...history,
      executions: [execution, ...history.executions.filter((item) => item.id !== execution.id)],
    });
  }

  private async readHistory(): Promise<RoutineHistory> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<RoutineHistory>(resolve(paths.routines, "history.json"), emptyHistory);
  }

  private async writeHistory(history: RoutineHistory): Promise<void> {
    const paths = await initializeLocalStore(this.root);
    await writeJsonFile(resolve(paths.routines, "history.json"), history);
  }
}

export const routineHistoryStore = new RoutineHistoryStore();
