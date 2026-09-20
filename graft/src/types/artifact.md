# src/types/artifact.ts

- ArtifactContent · type · L1-L2 — type ArtifactContent = string | number | boolean | null | ArtifactContent[] | { [key: string]: ArtifactContent };
- ContextReference · type · L4-L15 — type ContextReference = { kind: | "file" | "area" | "repo" | "repo_context" | "skill" | "work_item" | "routine" | "incoming_signal"; ref: string; };
- WorkflowReference · type · L17-L28 — type WorkflowReference = { kind: | "skill" | "routine" | "work_item" | "incoming_signal" | "policy" | "operational_event" | "operational_incident"; ref: string; label?: string; };
- ArtifactProvenance · type · L30-L34 — type ArtifactProvenance = { repositoryId: string; repositoryRoot: string; workflowRefs: WorkflowReference[]; };
- Artifact · type · L36-L47 — type Artifact = { id: string; name: string; type: string; content: ArtifactContent; tags: string[]; contextRefs: ContextReference[]; createdAt: string; repositoryId?: string; repositoryRoot?: string; provenance?: ArtifactProvenance; };
- ArtifactIndexEntry · type · L49-L49 — type ArtifactIndexEntry = Omit<Artifact, "content">;
- CreateArtifactInput · type · L51-L60 — type CreateArtifactInput = { name: string; type: string; content: ArtifactContent; tags?: string[]; contextRefs?: ContextReference[]; repositoryId?: string; repositoryRoot?: string; provenance?: ArtifactProvenance; };
- ListArtifactsOptions · type · L62-L66 — type ListArtifactsOptions = { type?: string; tag?: string; limit?: number; };
