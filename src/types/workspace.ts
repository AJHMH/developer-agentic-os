import type { GitStatus } from "./repo-memory";
import type { ArtifactStore } from "@/server/artifacts/artifact-store";
import type { HandoffStore } from "@/server/handoffs/handoff-store";
import type { IncomingSignalStore } from "@/server/incoming-signals/incoming-signal-store";
import type { SkillRunStore } from "@/server/skill-runs/skill-run-store";
import type { RoutineHistoryStore } from "@/server/routines/routine-history-store";
import type { WorkItemStore } from "@/server/work-items/work-item-store";
import type { LocalStorePaths } from "@/server/local-store/paths";

export type RepositoryContext = {
  id: string;
  name: string;
  path: string;
};

export type RepositorySwitcherEntry = RepositoryContext & {
  git: GitStatus;
};

export type Workspace = {
  repositories: RepositoryContext[];
  activeRepositoryId: string | null;
};

/**
 * WorkspaceContext holds singleton store instances for the lifetime of a request or background job.
 * This enables dependency injection and eliminates N² store instantiations.
 *
 * All modules should receive WorkspaceContext via function parameter,
 * not create stores internally.
 */
export type WorkspaceContext = {
  root: string;
  paths: LocalStorePaths;
  artifactStore: ArtifactStore;
  handoffStore: HandoffStore;
  incomingSignalStore: IncomingSignalStore;
  skillRunStore: SkillRunStore;
  routineHistoryStore: RoutineHistoryStore;
  workItemStore: WorkItemStore;
};
