# src/server/skills/skill-registry.ts

- SkillRegistryOptions · type · L10-L15 — type SkillRegistryOptions = { context?: WorkspaceContext; root?: string; artifactStore?: ArtifactStore; runStore?: SkillRunStore; };
- createSkillRegistry · function · L30-L59 — function createSkillRegistry(options: SkillRegistryOptions = {})
- listSkills · method · L47-L49 — listSkills(): SkillCommand[]
- runSkill · method · L51-L57 — async runSkill( id: string, input: Record<string, string> = {}, options: { workflowRefs?: WorkflowReference[] } = {} ): Promise<SkillRunResult>
