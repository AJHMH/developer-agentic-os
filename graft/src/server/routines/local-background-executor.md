# src/server/routines/local-background-executor.ts

- ExecutorClock · type · L13-L13 — type ExecutorClock = { now(): Date };
- RoutineExecutorTrigger · type · L14-L14 — type RoutineExecutorTrigger = { repositoryId?: string };
- ExecutorState · type · L16-L16 — type ExecutorState = RoutineExecutorStatus & { leaseToken: string | null };
- LocalBackgroundExecutorOptions · type · L29-L34 — type LocalBackgroundExecutorOptions = { root?: string; clock?: ExecutorClock; leaseTtlMs?: number; intervalMs?: number; };
- createLocalBackgroundExecutor · function · L36-L216 — function createLocalBackgroundExecutor(options: LocalBackgroundExecutorOptions = {})
- getState · function · L45-L48 — async function getState(): Promise<ExecutorState>
- saveState · function · L50-L53 — async function saveState(state: ExecutorState): Promise<void>
- withProcessLock · function · L55-L70 — async function withProcessLock<T>(work: () => Promise<T>): Promise<T>
- acquireLease · function · L72-L91 — async function acquireLease(): Promise<string | null>
- releaseLease · function · L93-L99 — async function releaseLease(token: string, error: string | null = null): Promise<void>
- resolveContext · function · L101-L104 — async function resolveContext(repositoryId?: string): Promise<RepositoryContext>
- runDue · function · L106-L158 — async function runDue(trigger: RoutineExecutorTrigger = {}): Promise<number>
- isDue · function · L160-L175 — async function isDue( routine: RoutineDefinition, workspaceContext: Awaited<ReturnType<typeof createWorkspaceContext>> ): Promise<boolean>
- start · method · L178-L187 — async start(trigger: RoutineExecutorTrigger = {}): Promise<RoutineExecutorStatus>
- stop · method · L188-L195 — async stop(): Promise<RoutineExecutorStatus>
- trigger · method · L196-L201 — async trigger( trigger: RoutineExecutorTrigger = {} ): Promise<{ executed: number; status: RoutineExecutorStatus }>
- status · method · L202-L214 — async status(): Promise<RoutineExecutorStatus>
- utcWeek · function · L218-L221 — function utcWeek(date: Date): number
