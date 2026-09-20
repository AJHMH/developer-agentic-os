# src/server/work-items/work-item-store.ts

- WorkItemError · class · L19-L27 — class WorkItemError extends Error
- constructor · method · L20-L26 — constructor( readonly code: "INVALID_INPUT" | "NOT_FOUND", message: string )
- WorkItemStore · class · L29-L111 — class WorkItemStore
- constructor · method · L30-L30 — constructor(private readonly root = process.cwd())
- list · method · L32-L41 — async list(options: ListWorkItemsOptions = {}): Promise<WorkItem[]>
- create · method · L43-L64 — async create(input: CreateWorkItemInput): Promise<WorkItem>
- update · method · L66-L101 — async update(id: string, input: UpdateWorkItemInput, repositoryId?: string): Promise<WorkItem>
- readItems · method · L103-L106 — private async readItems(): Promise<WorkItem[]>
- writeItems · method · L108-L110 — private async writeItems(items: WorkItem[]): Promise<void>
- validateCreate · function · L115-L121 — function validateCreate(input: CreateWorkItemInput): void
- validateUpdate · function · L123-L141 — function validateUpdate(input: UpdateWorkItemInput): void
- invalidReference · function · L143-L158 — function invalidReference(reference: WorkItemContextReference): boolean
