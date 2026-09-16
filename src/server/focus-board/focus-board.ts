import type { WorkspaceContext } from "@/types/workspace";
import { ArtifactStore } from "../artifacts/artifact-store";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import { createRoutineRegistry } from "../routines/routine-registry";
import { RoutineHistoryStore } from "../routines/routine-history-store";
import { WorkItemStore } from "../work-items/work-item-store";
import type { FocusBoard, FocusBoardWorkItem } from "@/types/focus-board";
import type { WorkItem } from "@/types/work-item";
import { OperationalStore } from "../operational/operational-store";

type FocusBoardOptions = {
  context?: WorkspaceContext;
  now?: () => Date;
  limit?: number;
  workItems?: WorkItemStore;
};

/**
 * Build a focus board aggregating work items, artifacts, and routine status.
 * Accepts optional WorkspaceContext for DI; creates stores from root if not provided.
 */
export async function getFocusBoard(
  repositoryId: string,
  repositoryRoot: string,
  options: FocusBoardOptions = {}
): Promise<FocusBoard> {
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 12;
  const context = options.context;
  const operationalStore = new OperationalStore(repositoryRoot);
  const [
    workItems,
    recentArtifacts,
    failedSkillRuns,
    failedRoutineExecutions,
    routines,
    operationalIncidents,
    operationalRuns,
  ] = await Promise.all([
    (options.workItems ?? context?.workItemStore ?? new WorkItemStore(repositoryRoot)).list({
      repositoryId,
    }),
    (context?.artifactStore ?? new ArtifactStore(repositoryRoot)).listArtifacts({ limit }),
    (context?.skillRunStore ?? new SkillRunStore(repositoryRoot)).listRuns({ limit }),
    (context?.routineHistoryStore ?? new RoutineHistoryStore(repositoryRoot)).listExecutions({
      limit,
    }),
    createRoutineRegistry(context ? { context } : { root: repositoryRoot }).listRoutines(),
    operationalStore.listIncidents({ repositoryId }),
    operationalStore.listRuns({ repositoryId }),
  ]);
  const nowValue = now().getTime();
  const withAttention = workItems
    .filter((item) => item.status !== "completed")
    .map((item): FocusBoardWorkItem => ({
      ...item,
      attention: attentionFor(item, nowValue),
    }))
    .sort(
      (left, right) =>
        attentionRank(left) - attentionRank(right) ||
        priorityRank(right.priority) - priorityRank(left.priority) ||
        right.updatedAt.localeCompare(left.updatedAt)
    );
  const routineNames = new Map(routines.map((routine) => [routine.id, routine.name]));

  return {
    repositoryId,
    generatedAt: now().toISOString(),
    workItems: withAttention.slice(0, limit),
    dueWorkItems: withAttention
      .filter((item) => item.attention === "due" || item.attention === "overdue")
      .slice(0, limit),
    overdueWorkItems: withAttention.filter((item) => item.attention === "overdue").slice(0, limit),
    blockedWorkItems: withAttention.filter((item) => item.attention === "blocked").slice(0, limit),
    recentArtifacts: recentArtifacts.slice(0, limit),
    failedSkillRuns: failedSkillRuns.filter((run) => run.status === "failed").slice(0, limit),
    failedRoutineExecutions: failedRoutineExecutions
      .filter((execution) => execution.status === "failed")
      .map((execution) => ({
        ...execution,
        routineName: routineNames.get(execution.routineId) ?? execution.routineId,
      }))
      .slice(0, limit),
    operationalIncidents: operationalIncidents
      .filter((incident) => incident.status === "active")
      .slice(0, limit),
    operationalRuns: operationalRuns
      .filter((run) =>
        [
          "queued",
          "running",
          "awaiting_approval",
          "failed",
          "paused",
          "retrying",
          "missed",
        ].includes(run.status)
      )
      .slice(0, limit),
  };
}

function attentionRank(item: FocusBoardWorkItem): number {
  return { blocked: 0, overdue: 1, due: 2, in_progress: 3, open: 4 }[item.attention];
}

function attentionFor(item: WorkItem, nowValue: number): FocusBoardWorkItem["attention"] {
  if (item.status === "blocked") return "blocked";
  if (item.dueAt && new Date(item.dueAt).getTime() < nowValue) return "overdue";
  if (item.dueAt) return "due";
  return item.status === "in_progress" ? "in_progress" : "open";
}

function priorityRank(priority: FocusBoardWorkItem["priority"]): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[priority];
}
