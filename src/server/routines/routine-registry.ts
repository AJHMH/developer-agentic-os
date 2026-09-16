import type { WorkspaceContext } from "@/types/workspace";
import { ArtifactStore } from "../artifacts/artifact-store";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import { createSkillRegistry } from "../skills/skill-registry";
import { RoutineHistoryStore } from "./routine-history-store";
import { getAllRoutines } from "./routine-definitions";
import type { RoutineDefinition, RoutineExecutionSource, RoutineRunResult } from "@/types/routine";
import { contextFromRoot } from "../workspace/repository-context";

type RoutineRegistryOptions = {
  context?: WorkspaceContext;
  root?: string;
  artifactStore?: ArtifactStore;
  skillRunStore?: SkillRunStore;
  historyStore?: RoutineHistoryStore;
  now?: () => Date;
};

/**
 * Creates a routine registry - the public API for routine operations.
 * This is now a thin factory that coordinates:
 * - Routine definitions (from routine-definitions.ts)
 * - Routine orchestrator (from routine-orchestrator.ts)
 * - Skill orchestrator (for executing routine workflows)
 *
 * Benefits:
 * - Definitions can be tested independently
 * - Orchestration logic is clear and centralized
 * - Easy to inject mock dependencies for testing
 */
export function createRoutineRegistry(options: RoutineRegistryOptions = {}) {
  const context = options.context;
  const root = context?.root ?? options.root ?? process.cwd();
  const history =
    context?.routineHistoryStore ?? options.historyStore ?? new RoutineHistoryStore(root);
  const now = options.now ?? (() => new Date());

  // Create skill orchestrator for executing routine workflows
  const skillRegistry = createSkillRegistry(
    context
      ? { context }
      : {
          root,
          artifactStore: options.artifactStore ?? new ArtifactStore(root),
          runStore: options.skillRunStore ?? new SkillRunStore(root),
        }
  );

  // Build definitions map for fast lookup
  const allRoutines = getAllRoutines();
  const routinesMap = new Map(allRoutines.map((routine) => [routine.id, routine]));

  return {
    async listRoutines(): Promise<RoutineDefinition[]> {
      return Promise.all(
        allRoutines.map(async (routine, index) => {
          const executions = await history.listExecutions({ routineId: routine.id, limit: 1 });
          const latest = executions[0];
          const lastRunAt = latest?.startedAt ?? null;
          const isPaused = await history.isPaused(routine.id);

          return {
            ...routine,
            status: isPaused ? "paused" : index === 0 ? "next" : routine.status,
            lastRunAt,
            nextDueAt: lastRunAt
              ? calculateNextDueAt(routine.scheduleLabel, new Date(lastRunAt)).toISOString()
              : now().toISOString(),
            lastExecutionSource: latest?.source ?? null,
          };
        })
      );
    },

    async runRoutine(
      id: string,
      options: { source?: RoutineExecutionSource } = {}
    ): Promise<RoutineRunResult> {
      const routine = routinesMap.get(id);
      if (!routine) throw new Error(`Unknown routine: ${id}`);
      await contextFromRoot(root);
      const execution = await history.createExecution(id, {
        source: options.source ?? "manual",
        startedAt: now().toISOString(),
      });

      if (routine.kind === "placeholder" || !routine.skillId) {
        const failed = await history.completeExecution(execution, {
          status: "failed",
          error: "Placeholder routine does not have executable behavior yet.",
        });
        return { status: "failed", execution: failed, artifactIds: [], error: failed.error };
      }

      const skillResult = await skillRegistry.runSkill(
        routine.skillId,
        {},
        { workflowRefs: [{ kind: "routine", ref: routine.id, label: routine.name }] }
      );
      const artifactIds = skillResult.run.artifactId ? [skillResult.run.artifactId] : [];
      const completed = await history.completeExecution(execution, {
        status: skillResult.status === "succeeded" ? "succeeded" : "failed",
        artifactIds,
        skillRunId: skillResult.run.id,
        error: skillResult.run.error,
        completedAt: now().toISOString(),
      });
      return {
        status: completed.status,
        execution: completed,
        artifactIds,
        error: completed.error,
      };
    },

    async pauseRoutine(id: string): Promise<RoutineDefinition> {
      const routine = routinesMap.get(id);
      if (!routine) throw new Error(`Unknown routine: ${id}`);
      await history.pauseRoutine(id);
      return { ...routine, status: "paused" };
    },

    async resumeRoutine(id: string): Promise<RoutineDefinition> {
      const routine = routinesMap.get(id);
      if (!routine) throw new Error(`Unknown routine: ${id}`);
      await history.resumeRoutine(id);
      return { ...routine, status: "queued" };
    },

    async listExecutions(options?: { limit?: number; routineId?: string }) {
      return history.listExecutions(options);
    },
  };
}

function calculateNextDueAt(scheduleLabel: string, lastRun: Date): Date {
  const next = new Date(lastRun);
  if (scheduleLabel === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export const routineRegistry = createRoutineRegistry();
