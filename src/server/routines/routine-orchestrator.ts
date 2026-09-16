import { RoutineHistoryStore } from "./routine-history-store";
import { SkillOrchestrator } from "../skills/skill-orchestrator";
import type { RoutineDefinition, RoutineExecutionSource, RoutineRunResult } from "@/types/routine";
import { contextFromRoot } from "../workspace/repository-context";

/**
 * RoutineOrchestrator: Deep module that coordinates routine execution.
 *
 * Responsibilities:
 * - List routines with current status and next due time
 * - Execute routine workflows (invoke skills)
 * - Pause/resume routines
 * - Track execution history
 *
 * Dependencies (injected):
 * - routine definitions
 * - history store (for tracking executions)
 * - skill orchestrator (for running skills)
 * - root path
 * - time function (for testing)
 */
export class RoutineOrchestrator {
  constructor(
    private root: string,
    private routineDefinitions: Map<string, RoutineDefinition>,
    private historyStore: RoutineHistoryStore,
    private skillOrchestrator: SkillOrchestrator,
    private now: () => Date
  ) {}

  /**
   * List all routines with current execution status and next due time.
   */
  async listRoutines(): Promise<RoutineDefinition[]> {
    const definitions = Array.from(this.routineDefinitions.values());
    return Promise.all(
      definitions.map(async (routine, index) => {
        const executions = await this.historyStore.listExecutions({
          routineId: routine.id,
          limit: 1,
        });
        const latest = executions[0];
        const lastRunAt = latest?.startedAt ?? null;
        const isPaused = await this.historyStore.isPaused(routine.id);

        return {
          ...routine,
          status: isPaused ? "paused" : index === 0 ? "next" : routine.status,
          lastRunAt,
          nextDueAt: lastRunAt
            ? calculateNextDueAt(routine.scheduleLabel, new Date(lastRunAt)).toISOString()
            : this.now().toISOString(),
          lastExecutionSource: latest?.source ?? null,
        };
      })
    );
  }

  /**
   * Execute a routine by ID.
   * Returns a complete RoutineRunResult with artifact references.
   */
  async runRoutine(
    id: string,
    options: { source?: RoutineExecutionSource } = {}
  ): Promise<RoutineRunResult> {
    const routine = this.routineDefinitions.get(id);
    if (!routine) throw new Error(`Unknown routine: ${id}`);

    // Validate repository context
    await contextFromRoot(this.root);

    // Create execution record
    const execution = await this.historyStore.createExecution(id, {
      source: options.source ?? "manual",
      startedAt: this.now().toISOString(),
    });

    // Placeholder routines cannot be executed
    if (routine.kind === "placeholder" || !routine.skillId) {
      const failed = await this.historyStore.completeExecution(execution, {
        status: "failed",
        error: "Placeholder routine does not have executable behavior yet.",
      });
      return { status: "failed", execution: failed, artifactIds: [], error: failed.error };
    }

    // Execute the linked skill
    const skillResult = await this.skillOrchestrator.runSkill(
      routine.skillId,
      {},
      { workflowRefs: [{ kind: "routine", ref: routine.id, label: routine.name }] }
    );
    const artifactIds = skillResult.run.artifactId ? [skillResult.run.artifactId] : [];

    // Complete execution
    const completed = await this.historyStore.completeExecution(execution, {
      status: skillResult.status === "succeeded" ? "succeeded" : "failed",
      artifactIds,
      skillRunId: skillResult.run.id,
      error: skillResult.run.error,
      completedAt: this.now().toISOString(),
    });

    return { status: completed.status, execution: completed, artifactIds, error: completed.error };
  }

  /**
   * Pause a routine (stops it from being scheduled).
   */
  async pauseRoutine(id: string): Promise<RoutineDefinition> {
    const routine = this.routineDefinitions.get(id);
    if (!routine) throw new Error(`Unknown routine: ${id}`);
    await this.historyStore.pauseRoutine(id);
    return { ...routine, status: "paused" };
  }

  /**
   * Resume a paused routine.
   */
  async resumeRoutine(id: string): Promise<RoutineDefinition> {
    const routine = this.routineDefinitions.get(id);
    if (!routine) throw new Error(`Unknown routine: ${id}`);
    await this.historyStore.resumeRoutine(id);
    return { ...routine, status: "queued" };
  }

  /**
   * List execution history.
   */
  async listExecutions(options?: { limit?: number; routineId?: string }) {
    return this.historyStore.listExecutions(options);
  }
}

/**
 * Calculate the next due time for a routine based on its schedule.
 */
function calculateNextDueAt(scheduleLabel: string, lastRun: Date): Date {
  const next = new Date(lastRun);
  if (scheduleLabel === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
