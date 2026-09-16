import type { RoutineDefinition } from "@/types/routine";

/**
 * Built-in routine definitions that are always available.
 * This is a pure data module - no dependencies, no orchestration.
 */
export const builtInRoutines: RoutineDefinition[] = [
  {
    id: "nightly_repo_digest",
    name: "Nightly Repo Digest",
    description: "Summarize the repo at the end of the day.",
    scheduleLabel: "nightly",
    kind: "built-in",
    executionMode: "local_background",
    status: "queued",
    skillId: "repo-summary",
  },
  {
    id: "weekly_sprint_digest",
    name: "Weekly Sprint Digest",
    description: "Summarize recent work for the week.",
    scheduleLabel: "weekly",
    kind: "built-in",
    executionMode: "local_background",
    status: "queued",
    skillId: "sprint-digest",
  },
  {
    id: "release_readiness_scan",
    name: "Release Readiness Scan",
    description: "Check shipping confidence and blockers.",
    scheduleLabel: "daily",
    kind: "built-in",
    executionMode: "local_background",
    status: "queued",
    skillId: "release-readiness",
  },
];

/**
 * Placeholder routines for future implementation.
 * These are shown to the user but cannot be executed.
 */
export const placeholderRoutines: RoutineDefinition[] = [
  {
    id: "stale_branch_check",
    name: "Stale Branch Check",
    description: "Find stale or forgotten branch work.",
    scheduleLabel: "weekly",
    kind: "placeholder",
    executionMode: "manual",
    status: "queued",
    skillId: null,
  },
  {
    id: "artifact_cleanup",
    name: "Artifact Cleanup",
    description: "Review local artifact retention.",
    scheduleLabel: "weekly",
    kind: "placeholder",
    executionMode: "manual",
    status: "queued",
    skillId: null,
  },
];

/**
 * Get all available routines (built-in + placeholder).
 */
export function getAllRoutines(): RoutineDefinition[] {
  return [...builtInRoutines, ...placeholderRoutines];
}

/**
 * Find a routine by ID.
 */
export function findRoutine(id: string): RoutineDefinition | undefined {
  return (
    builtInRoutines.find((item) => item.id === id) ??
    placeholderRoutines.find((item) => item.id === id)
  );
}
