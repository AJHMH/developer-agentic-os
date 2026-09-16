import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { SkillCommand, SkillRunRecord } from "@/types/skill";
import { initializeLocalStore } from "../local-store/paths";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { repositoryId } from "../workspace/repository-context";

type SkillRunIndex = {
  runs: SkillRunRecord[];
};

const emptyIndex: SkillRunIndex = { runs: [] };

export class SkillRunStore {
  private readonly repositoryRoot: string;
  private readonly repositoryContextId: string;

  constructor(private readonly root = process.cwd()) {
    this.repositoryRoot = resolve(root);
    this.repositoryContextId = repositoryId(this.repositoryRoot);
  }

  async createRun(skill: SkillCommand, input: Record<string, string>): Promise<SkillRunRecord> {
    const run: SkillRunRecord = {
      id: randomUUID(),
      skillId: skill.id,
      status: "queued",
      model: skill.model,
      effort: skill.effort,
      input,
      artifactId: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      repositoryId: this.repositoryContextId,
      repositoryRoot: this.repositoryRoot,
    };
    await this.saveRun(run);
    return run;
  }

  async updateRun(run: SkillRunRecord): Promise<SkillRunRecord> {
    await this.saveRun(run);
    return run;
  }

  async listRuns({ limit = 50, skillId }: { limit?: number; skillId?: string } = {}): Promise<
    SkillRunRecord[]
  > {
    const index = await this.readIndex();
    return index.runs.filter((run) => !skillId || run.skillId === skillId).slice(0, limit);
  }

  private async saveRun(run: SkillRunRecord): Promise<void> {
    const paths = await initializeLocalStore(this.root);
    const index = await this.readIndex();
    const runs = [run, ...index.runs.filter((item) => item.id !== run.id)];
    await writeJsonFile(resolve(paths.skillRuns, `${run.id}.json`), run);
    await writeJsonFile(resolve(paths.skillRuns, "index.json"), { runs });
  }

  private async readIndex(): Promise<SkillRunIndex> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<SkillRunIndex>(resolve(paths.skillRuns, "index.json"), emptyIndex);
  }
}

export const skillRunStore = new SkillRunStore();
