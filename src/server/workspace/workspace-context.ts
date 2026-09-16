import { initializeLocalStore } from "../local-store/paths";
import { ArtifactStore } from "../artifacts/artifact-store";
import { HandoffStore } from "../handoffs/handoff-store";
import { IncomingSignalStore } from "../incoming-signals/incoming-signal-store";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import { RoutineHistoryStore } from "../routines/routine-history-store";
import { WorkItemStore } from "../work-items/work-item-store";
import type { WorkspaceContext } from "@/types/workspace";

/**
 * Creates a WorkspaceContext with singleton store instances.
 * Call this once per request or background job, then pass it to all modules.
 *
 * This eliminates N² store instantiations and enables dependency injection for testability.
 */
export async function createWorkspaceContext(root = process.cwd()): Promise<WorkspaceContext> {
  const paths = await initializeLocalStore(root);

  const artifactStore = new ArtifactStore(root);
  const handoffStore = new HandoffStore(root);
  const incomingSignalStore = new IncomingSignalStore(root);
  const skillRunStore = new SkillRunStore(root);
  const routineHistoryStore = new RoutineHistoryStore(root);
  const workItemStore = new WorkItemStore(root);

  // Create context with all singleton stores
  const context: WorkspaceContext = {
    root,
    paths,
    artifactStore,
    handoffStore,
    incomingSignalStore,
    skillRunStore,
    routineHistoryStore,
    workItemStore,
  };

  return context;
}
