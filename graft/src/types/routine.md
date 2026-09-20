# src/types/routine.ts

- RoutineStatus · type · L1-L2 — type RoutineStatus = "queued" | "next" | "running" | "succeeded" | "failed" | "paused" | "missed";
- RoutineKind · type · L3-L3 — type RoutineKind = "built-in" | "placeholder";
- RoutineExecutionMode · type · L4-L4 — type RoutineExecutionMode = "manual" | "local_background";
- RoutineExecutionSource · type · L5-L5 — type RoutineExecutionSource = "manual" | "local_background";
- RoutineDefinition · type · L7-L20 — type RoutineDefinition = { id: string; name: string; description: string; scheduleLabel: string; kind: RoutineKind; executionMode: RoutineExecutionMode; status: RoutineStatus; skillId: string | null; repositoryId?: string | null; lastRunAt?: string | null; nextDueAt?: string | null; lastExecutionSource?: RoutineExecutionSource | null; };
- RoutineExecutionRecord · type · L22-L34 — type RoutineExecutionRecord = { id: string; routineId: string; status: RoutineStatus; startedAt: string; completedAt: string | null; artifactIds: string[]; skillRunId: string | null; error: string | null; source: RoutineExecutionSource; repositoryId?: string; repositoryRoot?: string; };
- RoutineRunResult · type · L36-L41 — type RoutineRunResult = { status: RoutineStatus; execution: RoutineExecutionRecord; artifactIds: string[]; error: string | null; };
- RoutineExecutorStatus · type · L43-L49 — type RoutineExecutorStatus = { running: boolean; leaseExpiresAt: string | null; lastTickAt: string | null; lastRunAt: string | null; lastError: string | null; };
