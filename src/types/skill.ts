import type { ArtifactContent, WorkflowReference } from "./artifact";

export type SkillKind = "built-in" | "placeholder";
export type SkillRunStatus = "queued" | "running" | "succeeded" | "failed";

export type SkillInputField = {
  name: string;
  label: string;
  required: boolean;
};

export type SkillCommand = {
  id: string;
  command: string;
  label: string;
  description: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  kind: SkillKind;
  inputs: SkillInputField[];
  status: "ready" | "placeholder";
};

export type SkillRunRecord = {
  id: string;
  skillId: string;
  status: SkillRunStatus;
  model: string;
  effort: SkillCommand["effort"];
  input: Record<string, string>;
  artifactId: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  repositoryId?: string;
  repositoryRoot?: string;
  workflowRefs?: WorkflowReference[];
};

export type SkillHandlerResult = {
  name: string;
  type: string;
  content: ArtifactContent;
  tags?: string[];
};

export type SkillRunResult = {
  status: SkillRunStatus;
  run: SkillRunRecord;
};
