# src/types/handoff.ts

- HandoffStatus · type · L7-L7 — type HandoffStatus = "draft" | "finalized";
- HandoffSnapshot · type · L9-L17 — type HandoffSnapshot = { repositoryContext: RepositoryContext; branch: string | null; changedFiles: string[]; workItems: WorkItem[]; artifacts: ArtifactIndexEntry[]; skillRuns: SkillRunRecord[]; repoMemory: RepoMemorySnapshot; };
- Handoff · type · L19-L31 — type Handoff = { id: string; title: string; status: HandoffStatus; snapshot: HandoffSnapshot; decisions: string[]; blockers: string[]; nextActions: string[]; createdAt: string; updatedAt: string; finalizedAt: string | null; artifactId: string | null; };
- CreateHandoffInput · type · L33-L38 — type CreateHandoffInput = { title?: string; decisions?: string[]; blockers?: string[]; nextActions?: string[]; };
- UpdateHandoffInput · type · L40-L42 — type UpdateHandoffInput = Partial< Pick<Handoff, "title" | "decisions" | "blockers" | "nextActions"> >;
