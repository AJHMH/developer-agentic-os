# src/types/work-item.ts

- WorkItemStatus · type · L1-L1 — type WorkItemStatus = "open" | "in_progress" | "blocked" | "completed";
- WorkItemPriority · type · L2-L2 — type WorkItemPriority = "low" | "normal" | "high" | "urgent";
- WorkItemContextReference · type · L4-L9 — type WorkItemContextReference = { kind: "file" | "area" | "artifact" | "skill" | "routine" | "incoming_signal" | "integration_event"; ref: string; label?: string; };
- WorkItemStatusChange · type · L11-L14 — type WorkItemStatusChange = { status: WorkItemStatus; changedAt: string; };
- WorkItem · type · L16-L30 — type WorkItem = { id: string; title: string; notes: string; status: WorkItemStatus; priority: WorkItemPriority; dueAt: string | null; dueNote: string | null; repositoryId: string; contextRefs: WorkItemContextReference[]; createdAt: string; updatedAt: string; completedAt: string | null; statusHistory: WorkItemStatusChange[]; };
- CreateWorkItemInput · type · L32-L41 — type CreateWorkItemInput = { title: string; notes?: string; status?: WorkItemStatus; priority?: WorkItemPriority; dueAt?: string | null; dueNote?: string | null; repositoryId: string; contextRefs?: WorkItemContextReference[]; };
- UpdateWorkItemInput · type · L43-L45 — type UpdateWorkItemInput = Partial< Pick<WorkItem, "title" | "notes" | "status" | "priority" | "dueAt" | "dueNote" | "contextRefs"> >;
- ListWorkItemsOptions · type · L47-L50 — type ListWorkItemsOptions = { repositoryId?: string; status?: WorkItemStatus; };
