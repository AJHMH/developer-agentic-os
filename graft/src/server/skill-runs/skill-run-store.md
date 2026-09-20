# src/server/skill-runs/skill-run-store.ts

- SkillRunIndex · type · L9-L11 — type SkillRunIndex = { runs: SkillRunRecord[]; };
- SkillRunStore · class · L15-L67 — class SkillRunStore
- constructor · method · L19-L22 — constructor(private readonly root = process.cwd())
- createRun · method · L24-L41 — async createRun(skill: SkillCommand, input: Record<string, string>): Promise<SkillRunRecord>
- updateRun · method · L43-L46 — async updateRun(run: SkillRunRecord): Promise<SkillRunRecord>
- listRuns · method · L48-L53 — async listRuns({ limit = 50, skillId }: { limit?: number; skillId?: string } = {}): Promise< SkillRunRecord[] >
- saveRun · method · L55-L61 — private async saveRun(run: SkillRunRecord): Promise<void>
- readIndex · method · L63-L66 — private async readIndex(): Promise<SkillRunIndex>
