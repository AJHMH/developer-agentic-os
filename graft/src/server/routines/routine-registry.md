# src/server/routines/routine-registry.ts

- RoutineRegistryOptions · type · L10-L17 — type RoutineRegistryOptions = { context?: WorkspaceContext; root?: string; artifactStore?: ArtifactStore; skillRunStore?: SkillRunStore; historyStore?: RoutineHistoryStore; now?: () => Date; };
- createRoutineRegistry · function · L31-L134 — function createRoutineRegistry(options: RoutineRegistryOptions = {})
- listRoutines · method · L54-L73 — async listRoutines(): Promise<RoutineDefinition[]>
- runRoutine · method · L75-L114 — async runRoutine( id: string, options: { source?: RoutineExecutionSource } = {} ): Promise<RoutineRunResult>
- pauseRoutine · method · L116-L121 — async pauseRoutine(id: string): Promise<RoutineDefinition>
- resumeRoutine · method · L123-L128 — async resumeRoutine(id: string): Promise<RoutineDefinition>
- listExecutions · method · L130-L132 — async listExecutions(options?: { limit?: number; routineId?: string })
- calculateNextDueAt · function · L136-L141 — function calculateNextDueAt(scheduleLabel: string, lastRun: Date): Date
