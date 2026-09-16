import type { WorkspaceContext } from "@/types/workspace";
import type { WorkflowReference } from "@/types/artifact";
import { ArtifactStore } from "../artifacts/artifact-store";
import { SkillRunStore } from "../skill-runs/skill-run-store";
import type { SkillCommand, SkillRunResult } from "@/types/skill";
import { createSkillHandlers } from "./skill-handlers";
import { getAllSkills } from "./skill-definitions";
import { SkillOrchestrator } from "./skill-orchestrator";

type SkillRegistryOptions = {
  context?: WorkspaceContext;
  root?: string;
  artifactStore?: ArtifactStore;
  runStore?: SkillRunStore;
};

/**
 * Creates a skill registry - the public API for skill operations.
 * This is now a thin factory that coordinates:
 * - Skill definitions (from skill-definitions.ts)
 * - Skill handlers (from skill-handlers.ts)
 * - Skill orchestrator (from skill-orchestrator.ts)
 *
 * Benefits:
 * - Definitions can be tested independently
 * - Handlers can be tested independently
 * - Orchestration logic is clear and centralized
 * - Easy to inject mock dependencies for testing
 */
export function createSkillRegistry(options: SkillRegistryOptions = {}) {
  const context = options.context;
  const root = context?.root ?? options.root ?? process.cwd();
  const artifacts = context?.artifactStore ?? options.artifactStore ?? new ArtifactStore(root);
  const runs = context?.skillRunStore ?? options.runStore ?? new SkillRunStore(root);

  // Build definitions map for fast lookup
  const allSkills = getAllSkills();
  const skillsMap = new Map(allSkills.map((skill) => [skill.id, skill]));

  // Create handlers (all in one place, independently testable)
  const handlers = createSkillHandlers(root);

  // Create orchestrator (pure orchestration logic)
  const orchestrator = new SkillOrchestrator(root, skillsMap, handlers, runs, artifacts);

  return {
    listSkills(): SkillCommand[] {
      return allSkills;
    },

    async runSkill(
      id: string,
      input: Record<string, string> = {},
      options: { workflowRefs?: WorkflowReference[] } = {}
    ): Promise<SkillRunResult> {
      return orchestrator.runSkill(id, input, options);
    },
  };
}
export const skillRegistry = createSkillRegistry();
