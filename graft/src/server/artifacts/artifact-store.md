# src/server/artifacts/artifact-store.ts

- ArtifactIndex · type · L15-L17 — type ArtifactIndex = { artifacts: ArtifactIndexEntry[]; };
- ArtifactStore · class · L22-L131 — class ArtifactStore
- constructor · method · L27-L31 — constructor(root = process.cwd())
- initialize · method · L33-L37 — async initialize()
- createArtifact · method · L39-L68 — async createArtifact(input: CreateArtifactInput): Promise<ArtifactIndexEntry>
- listArtifacts · method · L70-L79 — async listArtifacts(options: ListArtifactsOptions = {}): Promise<ArtifactIndexEntry[]>
- getArtifact · method · L81-L97 — async getArtifact(id: string): Promise<Artifact | null>
- toIndexEntry · method · L99-L111 — private toIndexEntry(artifact: Artifact): ArtifactIndexEntry
- readIndex · method · L113-L121 — private async readIndex(): Promise<ArtifactIndex>
- writeIndex · method · L123-L126 — private async writeIndex(index: ArtifactIndex): Promise<void>
- isSafeArtifactId · method · L128-L130 — private isSafeArtifactId(id: string): boolean
