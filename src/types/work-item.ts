export type WorkItemStatus = "open" | "in_progress" | "blocked" | "completed";
export type WorkItemPriority = "low" | "normal" | "high" | "urgent";

export type WorkItemContextReference = {
  kind:
    "file" | "area" | "artifact" | "skill" | "routine" | "incoming_signal" | "integration_event";
  ref: string;
  label?: string;
};

export type WorkItemStatusChange = {
  status: WorkItemStatus;
  changedAt: string;
};

export type WorkItem = {
  id: string;
  title: string;
  notes: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt: string | null;
  dueNote: string | null;
  repositoryId: string;
  contextRefs: WorkItemContextReference[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  statusHistory: WorkItemStatusChange[];
};

export type CreateWorkItemInput = {
  title: string;
  notes?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  dueAt?: string | null;
  dueNote?: string | null;
  repositoryId: string;
  contextRefs?: WorkItemContextReference[];
};

export type UpdateWorkItemInput = Partial<
  Pick<WorkItem, "title" | "notes" | "status" | "priority" | "dueAt" | "dueNote" | "contextRefs">
>;

export type ListWorkItemsOptions = {
  repositoryId?: string;
  status?: WorkItemStatus;
};
