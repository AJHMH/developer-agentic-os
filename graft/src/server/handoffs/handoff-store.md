# src/server/handoffs/handoff-store.ts

- HandoffIndex · type · L18-L18 — type HandoffIndex = { handoffs: Handoff[] };
- HandoffError · class · L21-L29 — class HandoffError extends Error
- constructor · method · L22-L28 — constructor( readonly code: "INVALID_INPUT" | "NOT_FOUND" | "FINALIZED", message: string )
- HandoffStore · class · L35-L156 — class HandoffStore
- constructor · method · L36-L39 — constructor( private readonly root = process.cwd(), private readonly context?: WorkspaceContext )
- list · method · L41-L46 — async list(repositoryId?: string): Promise<Handoff[]>
- get · method · L48-L53 — async get(id: string, repositoryId?: string): Promise<Handoff>
- create · method · L55-L88 — async create(context: RepositoryContext, input: CreateHandoffInput = {}): Promise<Handoff>
- update · method · L90-L105 — async update(id: string, input: UpdateHandoffInput, repositoryId?: string): Promise<Handoff>
- finalize · method · L107-L141 — async finalize(id: string, repositoryId?: string): Promise<Handoff>
- save · method · L143-L150 — private async save(handoff: Handoff): Promise<void>
- readIndex · method · L152-L155 — private async readIndex(): Promise<HandoffIndex>
- validateInput · function · L160-L170 — function validateInput(input: CreateHandoffInput | UpdateHandoffInput): void
- cleanLines · function · L172-L174 — function cleanLines(lines: string[] | undefined): string[]
