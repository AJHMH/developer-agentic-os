export type RoutineStatus =
  "queued" | "next" | "running" | "succeeded" | "failed" | "paused" | "missed";
export type RoutineKind = "built-in" | "placeholder";
export type RoutineExecutionMode = "manual" | "local_background";
export type RoutineExecutionSource = "manual" | "local_background";

export type RoutineDefinition = {
  id: string;
  name: string;
  description: string;
  scheduleLabel: string;
  kind: RoutineKind;
  executionMode: RoutineExecutionMode;
  status: RoutineStatus;
  skillId: string | null;
  repositoryId?: string | null;
  lastRunAt?: string | null;
  nextDueAt?: string | null;
  lastExecutionSource?: RoutineExecutionSource | null;
};

export type RoutineExecutionRecord = {
  id: string;
  routineId: string;
  status: RoutineStatus;
  startedAt: string;
  completedAt: string | null;
  artifactIds: string[];
  skillRunId: string | null;
  error: string | null;
  source: RoutineExecutionSource;
  repositoryId?: string;
  repositoryRoot?: string;
};

export type RoutineRunResult = {
  status: RoutineStatus;
  execution: RoutineExecutionRecord;
  artifactIds: string[];
  error: string | null;
};

export type RoutineExecutorStatus = {
  running: boolean;
  leaseExpiresAt: string | null;
  lastTickAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};
