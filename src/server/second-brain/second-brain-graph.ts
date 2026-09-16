import type { SecondBrainGraph } from "@/types/second-brain";
import type { WorkspaceContext } from "@/types/workspace";
import { ArtifactStore } from "../artifacts/artifact-store";
import { HandoffStore } from "../handoffs/handoff-store";
import { IncomingSignalStore } from "../incoming-signals/incoming-signal-store";
import { getRepoMemorySnapshot } from "../repo-memory/repo-memory";
import { createSkillRegistry } from "../skills/skill-registry";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import { createRoutineRegistry } from "../routines/routine-registry";
import { RoutineHistoryStore } from "../routines/routine-history-store";
import { WorkItemStore } from "../work-items/work-item-store";
import { repositoryId } from "../workspace/repository-context";
import { GraphBuilder } from "./graph-builder";

/**
 * Build the Second Brain graph with injected context.
 * Accepts WorkspaceContext for DI, or creates stores from root (backward compatible).
 *
 * Uses GraphBuilder to centralize graph construction semantics.
 */
export async function buildSecondBrainGraph(
  contextOrRoot?: WorkspaceContext | string
): Promise<SecondBrainGraph> {
  const context = typeof contextOrRoot === "string" || !contextOrRoot ? null : contextOrRoot;
  const root = context?.root ?? (typeof contextOrRoot === "string" ? contextOrRoot : process.cwd());
  const contextId = repositoryId(root);

  const snapshot = await getRepoMemorySnapshot(root);
  const artifacts = await (context?.artifactStore ?? new ArtifactStore(root)).listArtifacts({
    limit: 100,
  });
  const signals = await (context?.incomingSignalStore ?? new IncomingSignalStore(root)).list({
    repositoryId: contextId,
  });
  const handoffs = await (context?.handoffStore ?? new HandoffStore(root)).list(contextId);
  const skillRuns = await (context?.skillRunStore ?? new SkillRunStore(root)).listRuns({
    limit: 100,
  });
  const skills = createSkillRegistry(context ? { context } : { root })
    .listSkills()
    .filter((skill) => skill.kind === "built-in");
  const workItems = await (context?.workItemStore ?? new WorkItemStore(root)).list({
    repositoryId: contextId,
  });
  const routines = await createRoutineRegistry(context ? { context } : { root }).listRoutines();
  const executions = await (
    context?.routineHistoryStore ?? new RoutineHistoryStore(root)
  ).listExecutions({ limit: 100 });

  const builder = new GraphBuilder();
  const contextNodeId = `repo_context:${contextId}`;

  // Add repository and context nodes
  builder.addRepo("repo:root", snapshot.repoName, snapshot.repoPath, { repositoryId: contextId });
  builder.addRepoContext(contextNodeId, snapshot.repoName, snapshot.repoPath, contextId);
  builder.addLink("repo:root", contextNodeId, "contains");

  // Add areas and files
  for (const area of snapshot.areas) {
    builder.addArea(`area:${area}`, area, "repo:root");
  }

  for (const file of snapshot.files) {
    const fileId = `file:${file.path}`;
    const area = file.path.includes("/") ? file.path.split("/")[0] : null;
    const parentId = area && snapshot.areas.includes(area) ? `area:${area}` : "repo:root";
    builder.addFile(fileId, file.path, parentId, { kind: file.kind });
  }

  // Add skills
  for (const skill of skills) {
    builder.addSkill(`skill:${skill.id}`, skill.command, {
      model: skill.model,
      effort: skill.effort,
    });
  }

  // Add signals
  for (const signal of signals) {
    builder.addSignal(`incoming_signal:${signal.id}`, signal.title, contextNodeId, {
      repositoryId: signal.repositoryId,
      status: signal.status,
      source: signal.source,
    });
  }

  // Add work items with context references
  for (const workItem of workItems) {
    builder.addWorkItem(`work_item:${workItem.id}`, workItem.title, contextNodeId, {
      repositoryId: workItem.repositoryId,
      status: workItem.status,
      priority: workItem.priority,
    });
    builder.addContextReferences(`work_item:${workItem.id}`, workItem.contextRefs, (id) =>
      builder.hasNode(id)
    );
  }

  // Add routines with skill triggers
  for (const routine of routines) {
    const routineId = `routine:${routine.id}`;
    const skillId = routine.skillId ? `skill:${routine.skillId}` : undefined;
    builder.addRoutine(routineId, routine.name, skillId, {
      schedule: routine.scheduleLabel,
      status: routine.status,
    });
  }

  // Add artifacts with provenance links
  for (const artifact of artifacts) {
    builder.addArtifact(`artifact:${artifact.id}`, artifact.name, {
      artifactType: artifact.type,
      createdAt: artifact.createdAt,
    });

    // Link artifact to its context
    if (artifact.repositoryId === contextId) {
      builder.addLink(`artifact:${artifact.id}`, contextNodeId, "scoped_to");
    }

    // Add context reference links (as "used_context" for artifacts)
    for (const contextRef of artifact.contextRefs) {
      const targetId = `${contextRef.kind}:${contextRef.ref}`;
      if (builder.hasNode(targetId)) {
        builder.addLink(`artifact:${artifact.id}`, targetId, "used_context");
      }
    }

    // Add provenance links
    builder.addProvenanceLinks(
      `artifact:${artifact.id}`,
      artifact.provenance?.workflowRefs ?? [],
      (id) => builder.hasNode(id)
    );
  }

  // Add skill -> artifact production links
  for (const run of skillRuns.filter((item) => item.repositoryId === contextId)) {
    if (
      run.artifactId &&
      builder.hasNode(`skill:${run.skillId}`) &&
      builder.hasNode(`artifact:${run.artifactId}`)
    ) {
      builder.addLink(`skill:${run.skillId}`, `artifact:${run.artifactId}`, "produced");
    }
  }

  // Add routine execution links
  for (const execution of executions.filter((item) => item.repositoryId === contextId)) {
    builder.addLink(`routine:${execution.routineId}`, contextNodeId, "scoped_to");
    for (const artifactId of execution.artifactIds) {
      if (
        builder.hasNode(`routine:${execution.routineId}`) &&
        builder.hasNode(`artifact:${artifactId}`)
      ) {
        builder.addLink(`routine:${execution.routineId}`, `artifact:${artifactId}`, "produced");
      }
    }
  }

  // Add handoffs with work items and artifacts
  for (const handoff of handoffs) {
    const handoffId = `handoff:${handoff.id}`;
    builder.addHandoff(handoffId, handoff.title, contextNodeId, {
      repositoryId: handoff.snapshot.repositoryContext.id,
      status: handoff.status,
    });

    for (const workItem of handoff.snapshot.workItems) {
      if (builder.hasNode(`work_item:${workItem.id}`)) {
        builder.addLink(handoffId, `work_item:${workItem.id}`, "includes");
      }
    }

    for (const artifact of handoff.snapshot.artifacts) {
      if (builder.hasNode(`artifact:${artifact.id}`)) {
        builder.addLink(handoffId, `artifact:${artifact.id}`, "includes");
      }
    }

    if (handoff.artifactId && builder.hasNode(`artifact:${handoff.artifactId}`)) {
      builder.addLink(handoffId, `artifact:${handoff.artifactId}`, "finalized_as");
    }
  }

  return builder.build();
}
