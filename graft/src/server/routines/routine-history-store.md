# src/server/routines/routine-history-store.ts

- RoutineHistory · type · L9-L12 — type RoutineHistory = { executions: RoutineExecutionRecord[]; pausedRoutineIds: string[]; };
- RoutineHistoryStore · class · L16-L115 — class RoutineHistoryStore
- constructor · method · L20-L23 — constructor(private readonly root = process.cwd())
- createExecution · method · L25-L44 — async createExecution( routineId: string, options: { source?: RoutineExecutionRecord["source"]; startedAt?: string } = {} ): Promise<RoutineExecutionRecord>
- completeExecution · method · L46-L66 — async completeExecution( execution: RoutineExecutionRecord, update: { status: RoutineStatus; artifactIds?: string[]; skillRunId?: string | null; error?: string | null; completedAt?: string; } ): Promise<RoutineExecutionRecord>
- listExecutions · method · L68-L76 — async listExecutions({ limit = 50, routineId, }: { limit?: number; routineId?: string } = {}): Promise<RoutineExecutionRecord[]>
- pauseRoutine · method · L78-L84 — async pauseRoutine(routineId: string): Promise<void>
- resumeRoutine · method · L86-L92 — async resumeRoutine(routineId: string): Promise<void>
- isPaused · method · L94-L96 — async isPaused(routineId: string): Promise<boolean>
- saveExecution · method · L98-L104 — private async saveExecution(execution: RoutineExecutionRecord): Promise<void>
- readHistory · method · L106-L109 — private async readHistory(): Promise<RoutineHistory>
- writeHistory · method · L111-L114 — private async writeHistory(history: RoutineHistory): Promise<void>
