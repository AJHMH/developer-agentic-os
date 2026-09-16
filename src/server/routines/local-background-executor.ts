import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { RepositoryContext } from "@/types/workspace";
import type { RoutineDefinition, RoutineExecutorStatus } from "@/types/routine";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { initializeLocalStore } from "../local-store/paths";
import { createWorkspaceContext } from "../workspace/workspace-context";
import { WorkspaceStore } from "../workspace/workspace-store";
import { createRoutineRegistry } from "./routine-registry";
import { createOperationalExecutor } from "../operational/operational-executor";

export type ExecutorClock = { now(): Date };
export type RoutineExecutorTrigger = { repositoryId?: string };

type ExecutorState = RoutineExecutorStatus & { leaseToken: string | null };

const defaultClock: ExecutorClock = { now: () => new Date() };
const defaultState: ExecutorState = { running: false, leaseExpiresAt: null, lastTickAt: null, lastRunAt: null, lastError: null, leaseToken: null };
const processLocks = new Map<string, Promise<void>>();

export type LocalBackgroundExecutorOptions = {
  root?: string;
  clock?: ExecutorClock;
  leaseTtlMs?: number;
  intervalMs?: number;
};

export function createLocalBackgroundExecutor(options: LocalBackgroundExecutorOptions = {}) {
  const root = options.root ?? process.cwd();
  const isApplicationExecutor = options.root === undefined;
  const clock = options.clock ?? defaultClock;
  const leaseTtlMs = options.leaseTtlMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 60_000;
  const workspace = new WorkspaceStore(root);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function getState(): Promise<ExecutorState> {
    const paths = await initializeLocalStore(root);
    return readJsonFile<ExecutorState>(resolve(paths.routines, "executor.json"), defaultState);
  }

  async function saveState(state: ExecutorState): Promise<void> {
    const paths = await initializeLocalStore(root);
    await writeJsonFile(resolve(paths.routines, "executor.json"), state);
  }

  async function withProcessLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = processLocks.get(root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    const queued = previous.then(() => current);
    processLocks.set(root, queued);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (processLocks.get(root) === queued) processLocks.delete(root);
    }
  }

  async function acquireLease(): Promise<string | null> {
    return withProcessLock(async () => {
      const state = await getState();
      const now = clock.now();
      if (state.leaseToken && state.leaseExpiresAt && Date.parse(state.leaseExpiresAt) > now.getTime()) return null;
      const token = randomUUID();
      await saveState({ ...state, leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(), lastError: null });
      return token;
    });
  }

  async function releaseLease(token: string, error: string | null = null): Promise<void> {
    await withProcessLock(async () => {
      const state = await getState();
      if (state.leaseToken !== token) return;
      await saveState({ ...state, leaseToken: null, leaseExpiresAt: null, lastError: error });
    });
  }

  async function resolveContext(repositoryId?: string): Promise<RepositoryContext> {
    if (repositoryId) return workspace.getContext(repositoryId);
    return workspace.getActiveContext();
  }

  async function runDue(trigger: RoutineExecutorTrigger = {}): Promise<number> {
    const token = await acquireLease();
    if (!token) return 0;
    let error: string | null = null;
    let count = 0;
    try {
      const requestedContext = await resolveContext(trigger.repositoryId);
      const contexts = trigger.repositoryId || !isApplicationExecutor ? [requestedContext] : await workspace.listRepositories();
      if (!contexts.some((context) => context.id === requestedContext.id)) contexts.unshift(requestedContext);
      for (const context of contexts) {
        count += await createOperationalExecutor(context.path).runDueSchedule(context.id);
        // Create WorkspaceContext once per repository to avoid N² store instantiations
        const workspaceContext = await createWorkspaceContext(context.path);
        const routines = await createRoutineRegistry({ context: workspaceContext }).listRoutines();
        for (const routine of routines) {
          if (routine.executionMode !== "local_background" || routine.status === "paused" || !(await isDue(routine, workspaceContext))) continue;
          const target = routine.repositoryId ? await resolveContext(routine.repositoryId) : context;
          const targetContext = target.id === context.id ? workspaceContext : await createWorkspaceContext(target.path);
          const registry = createRoutineRegistry({ context: targetContext, now: clock.now.bind(clock) });
          const result = await registry.runRoutine(routine.id, { source: "local_background" });
          count += 1;
          if (result.status === "failed") error = result.error ?? `Routine ${routine.id} failed.`;
        }
      }
      const state = await getState();
      await saveState({ ...state, lastTickAt: clock.now().toISOString(), lastRunAt: count ? clock.now().toISOString() : state.lastRunAt });
      return count;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Background executor failed.";
      throw caught;
    } finally {
      await releaseLease(token, error);
    }
  }

  async function isDue(routine: RoutineDefinition, workspaceContext: Awaited<ReturnType<typeof createWorkspaceContext>>): Promise<boolean> {
    const executions = await createRoutineRegistry({ context: workspaceContext }).listExecutions({ routineId: routine.id, limit: 20 });
    const latest = executions[0];
    if (!latest) return true;
    const now = clock.now();
    const last = new Date(latest.startedAt);
    if (routine.scheduleLabel === "weekly") return utcWeek(now) !== utcWeek(last) || now.getUTCFullYear() !== last.getUTCFullYear();
    return now.toISOString().slice(0, 10) !== last.toISOString().slice(0, 10);
  }

  return {
    async start(trigger: RoutineExecutorTrigger = {}): Promise<RoutineExecutorStatus> {
      if (!timer) timer = setInterval(() => { void runDue(trigger); }, intervalMs);
      const state = await getState();
      await saveState({ ...state, running: true });
      await runDue(trigger);
      return this.status();
    },
    async stop(): Promise<RoutineExecutorStatus> {
      if (timer) clearInterval(timer);
      timer = null;
      const state = await getState();
      if (state.leaseToken) await releaseLease(state.leaseToken);
      await saveState({ ...(await getState()), running: false });
      return this.status();
    },
    async trigger(trigger: RoutineExecutorTrigger = {}): Promise<{ executed: number; status: RoutineExecutorStatus }> {
      const executed = await runDue(trigger);
      return { executed, status: await this.status() };
    },
    async status(): Promise<RoutineExecutorStatus> {
      const state = await getState();
      const expired = state.leaseExpiresAt ? Date.parse(state.leaseExpiresAt) <= clock.now().getTime() : false;
      return { running: state.running, leaseExpiresAt: expired ? null : state.leaseExpiresAt, lastTickAt: state.lastTickAt, lastRunAt: state.lastRunAt, lastError: state.lastError };
    },
  };
}

function utcWeek(date: Date): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - start.getTime()) / 86_400_000) + start.getUTCDay() + 1) / 7);
}

export const localBackgroundExecutor = createLocalBackgroundExecutor();