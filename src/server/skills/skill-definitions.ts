import type { SkillCommand } from "@/types/skill";

/**
 * Built-in skills that are always available.
 * This is a pure data module - no dependencies, no orchestration.
 */
export const builtInSkills: SkillCommand[] = [
  command("repo-summary", "/repo-summary", "Repo Summary", "Summarize the current repository.", []),
  command(
    "branch-summary",
    "/branch-summary",
    "Branch Summary",
    "Summarize branch changes against a base branch.",
    [
      { name: "baseBranch", label: "Base branch", required: true },
      { name: "targetBranch", label: "Target branch", required: true },
    ]
  ),
  command(
    "release-readiness",
    "/release-readiness",
    "Release Readiness",
    "Assess release readiness from local repo signals.",
    []
  ),
  command(
    "implementation-checklist",
    "/implementation-checklist",
    "Implementation Checklist",
    "Create a checklist from work item text.",
    [{ name: "workItem", label: "Work item text", required: true }]
  ),
  command(
    "sprint-digest",
    "/sprint-digest",
    "Sprint Digest",
    "Summarize recent repository motion.",
    []
  ),
];

/**
 * Placeholder skills for future implementation.
 * These are shown to the user but cannot be executed.
 */
export const placeholderSkills: SkillCommand[] = [
  placeholder("newsletter", "/newsletter", "Newsletter"),
  placeholder("games", "/games", "Games"),
  placeholder("clean-up", "/clean-up", "Clean Up"),
];

/**
 * Get all available skills (built-in + placeholder).
 */
export function getAllSkills(): SkillCommand[] {
  return [...builtInSkills, ...placeholderSkills];
}

/**
 * Find a skill by ID.
 */
export function findSkill(id: string): SkillCommand | undefined {
  return (
    builtInSkills.find((item) => item.id === id) ?? placeholderSkills.find((item) => item.id === id)
  );
}

// Helper functions for creating skill definitions
function command(
  id: string,
  commandText: string,
  label: string,
  description: string,
  inputs: SkillCommand["inputs"]
): SkillCommand {
  return {
    id,
    command: commandText,
    label,
    description,
    model: "sonnet",
    effort: "medium",
    kind: "built-in",
    inputs,
    status: "ready",
  };
}

function placeholder(id: string, commandText: string, label: string): SkillCommand {
  return {
    id,
    command: commandText,
    label,
    description: "Placeholder skill for a later build.",
    model: "opus",
    effort: "xhigh",
    kind: "placeholder",
    inputs: [],
    status: "placeholder",
  };
}
