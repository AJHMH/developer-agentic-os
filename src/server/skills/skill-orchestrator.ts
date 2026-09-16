import { ArtifactStore } from "../artifacts/artifact-store";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import type { WorkflowReference } from "@/types/artifact";
import type { SkillCommand, SkillRunResult } from "@/types/skill";
import { contextFromRoot } from "../workspace/repository-context";
import type { SkillHandler } from "./skill-handlers";

/**
 * SkillOrchestrator: Deep module that coordinates skill execution.
 *
 * Responsibilities:
 * - Create and manage skill runs (state tracking)
 * - Execute skill handlers (invoke business logic)
 * - Create artifacts from results
 * - Handle errors and failures
 *
 * Dependencies (injected):
 * - skill definitions
 * - skill handlers
 * - run store
 * - artifact store
 */
export class SkillOrchestrator {
  constructor(
    private root: string,
    private skillDefinitions: Map<string, SkillCommand>,
    private handlers: Record<string, SkillHandler>,
    private runStore: SkillRunStore,
    private artifactStore: ArtifactStore
  ) {}

  /**
   * Execute a skill by ID with input parameters.
   * Returns a complete SkillRunResult with artifact references.
   */
  async runSkill(
    id: string,
    input: Record<string, string> = {},
    options: { workflowRefs?: WorkflowReference[] } = {}
  ): Promise<SkillRunResult> {
    const skill = this.skillDefinitions.get(id);
    if (!skill) throw new Error(`Unknown skill: ${id}`);

    // Validate repository context
    await contextFromRoot(this.root);

    // Create run record
    const run = await this.runStore.createRun(skill, input);

    // Placeholder skills cannot be executed
    if (skill.kind === "placeholder") {
      return failRun(
        this.runStore,
        { ...run, status: "running" },
        "Placeholder skills do not have executable handlers yet."
      );
    }

    try {
      // Mark as running
      await this.runStore.updateRun({ ...run, status: "running" });

      // Validate required inputs
      for (const field of skill.inputs.filter((field) => field.required)) {
        if (!input[field.name]?.trim()) {
          throw new Error(`${field.label} is required.`);
        }
      }

      // Check handler exists (guard against missing handlers)
      if (!this.handlers[skill.id]) {
        throw new Error(`No handler registered for skill: ${skill.id}`);
      }

      // Execute the handler
      const output = await this.handlers[skill.id](input);

      // Create artifact from result
      const artifactEntry = await this.artifactStore.createArtifact({
        ...output,
        provenance: {
          repositoryId: run.repositoryId ?? "",
          repositoryRoot: run.repositoryRoot ?? this.root,
          workflowRefs: [
            { kind: "skill", ref: skill.id, label: skill.label },
            ...(options.workflowRefs ?? []),
          ],
        },
      });

      // Complete run successfully
      const completed = await this.runStore.updateRun({
        ...run,
        status: "succeeded",
        artifactId: artifactEntry.id,
        completedAt: new Date().toISOString(),
      });

      return { status: "succeeded", run: completed };
    } catch (error) {
      return failRun(
        this.runStore,
        { ...run, status: "running" },
        error instanceof Error ? error.message : "Skill failed."
      );
    }
  }
}

async function failRun(
  runStore: SkillRunStore,
  run: Awaited<ReturnType<SkillRunStore["createRun"]>>,
  error: string
): Promise<SkillRunResult> {
  const failed = await runStore.updateRun({
    ...run,
    status: "failed",
    artifactId: null,
    error,
    completedAt: new Date().toISOString(),
  });
  return { status: "failed", run: failed };
}
