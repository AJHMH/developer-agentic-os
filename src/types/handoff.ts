import type { ArtifactIndexEntry } from "./artifact";
import type { RepoMemorySnapshot } from "./repo-memory";
import type { SkillRunRecord } from "./skill";
import type { WorkItem } from "./work-item";
import type { RepositoryContext } from "./workspace";

export type HandoffStatus = "draft" | "finalized";

export type HandoffSnapshot = {
  repositoryContext: RepositoryContext;
  branch: string | null;
  changedFiles: string[];
  workItems: WorkItem[];
  artifacts: ArtifactIndexEntry[];
  skillRuns: SkillRunRecord[];
  repoMemory: RepoMemorySnapshot;
};

export type Handoff = {
  id: string;
  title: string;
  status: HandoffStatus;
  snapshot: HandoffSnapshot;
  decisions: string[];
  blockers: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  artifactId: string | null;
};

export type CreateHandoffInput = {
  title?: string;
  decisions?: string[];
  blockers?: string[];
  nextActions?: string[];
};

export type UpdateHandoffInput = Partial<
  Pick<Handoff, "title" | "decisions" | "blockers" | "nextActions">
>;
