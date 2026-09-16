import { randomUUID } from "node:crypto";

import type {
  CreateWorkItemInput,
  ListWorkItemsOptions,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemContextReference,
  WorkItemPriority,
  WorkItemStatus,
} from "@/types/work-item";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { getLocalStorePaths, initializeLocalStore } from "../local-store/paths";

const emptyItems: WorkItem[] = [];
const statuses: WorkItemStatus[] = ["open", "in_progress", "blocked", "completed"];
const priorities: WorkItemPriority[] = ["low", "normal", "high", "urgent"];

export class WorkItemError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "WorkItemError";
  }
}

export class WorkItemStore {
  constructor(private readonly root = process.cwd()) {}

  async list(options: ListWorkItemsOptions = {}): Promise<WorkItem[]> {
    const items = await this.readItems();
    return items
      .filter(
        (item) =>
          (!options.repositoryId || item.repositoryId === options.repositoryId) &&
          (!options.status || item.status === options.status)
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    validateCreate(input);
    const now = new Date().toISOString();
    const status = input.status ?? "open";
    const item: WorkItem = {
      id: randomUUID(),
      title: input.title.trim(),
      notes: input.notes?.trim() ?? "",
      status,
      priority: input.priority ?? "normal",
      dueAt: input.dueAt ?? null,
      dueNote: input.dueNote?.trim() || null,
      repositoryId: input.repositoryId.trim(),
      contextRefs: input.contextRefs ?? [],
      createdAt: now,
      updatedAt: now,
      completedAt: status === "completed" ? now : null,
      statusHistory: [{ status, changedAt: now }],
    };
    await this.writeItems([item, ...(await this.readItems())]);
    return item;
  }

  async update(id: string, input: UpdateWorkItemInput, repositoryId?: string): Promise<WorkItem> {
    const items = await this.readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || (repositoryId && items[index].repositoryId !== repositoryId))
      throw new WorkItemError("NOT_FOUND", "Work item not found.");
    validateUpdate(input);
    const current = items[index];
    const now = new Date().toISOString();
    const statusChanged = input.status !== undefined && input.status !== current.status;
    const updated: WorkItem = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.dueNote !== undefined ? { dueNote: input.dueNote } : {}),
      ...(input.contextRefs !== undefined ? { contextRefs: input.contextRefs } : {}),
      title: input.title?.trim() ?? current.title,
      notes: input.notes?.trim() ?? current.notes,
      dueNote: input.dueNote?.trim() || (input.dueNote === "" ? null : current.dueNote),
      updatedAt: now,
      completedAt:
        input.status === "completed"
          ? (current.completedAt ?? now)
          : input.status !== undefined
            ? null
            : current.completedAt,
      statusHistory: statusChanged
        ? [...current.statusHistory, { status: input.status as WorkItemStatus, changedAt: now }]
        : current.statusHistory,
    };
    items[index] = updated;
    await this.writeItems(items);
    return updated;
  }

  private async readItems(): Promise<WorkItem[]> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<WorkItem[]>(paths.workItems, emptyItems);
  }

  private async writeItems(items: WorkItem[]): Promise<void> {
    await writeJsonFile(getLocalStorePaths(this.root).workItems, items);
  }
}

export const workItemStore = new WorkItemStore();

function validateCreate(input: CreateWorkItemInput): void {
  if (!input || typeof input.title !== "string" || !input.title.trim())
    throw new WorkItemError("INVALID_INPUT", "title is required");
  if (typeof input.repositoryId !== "string" || !input.repositoryId.trim())
    throw new WorkItemError("INVALID_INPUT", "repositoryId is required");
  validateUpdate(input);
}

function validateUpdate(input: UpdateWorkItemInput): void {
  if (input.title !== undefined && typeof input.title !== "string")
    throw new WorkItemError("INVALID_INPUT", "title must be a string");
  if (input.notes !== undefined && typeof input.notes !== "string")
    throw new WorkItemError("INVALID_INPUT", "notes must be a string");
  if (input.dueNote !== undefined && input.dueNote !== null && typeof input.dueNote !== "string")
    throw new WorkItemError("INVALID_INPUT", "dueNote must be a string or null");
  if (input.dueAt !== undefined && input.dueAt !== null && typeof input.dueAt !== "string")
    throw new WorkItemError("INVALID_INPUT", "dueAt must be a string or null");
  if (input.status !== undefined && !statuses.includes(input.status))
    throw new WorkItemError("INVALID_INPUT", "Invalid work item status");
  if (input.priority !== undefined && !priorities.includes(input.priority))
    throw new WorkItemError("INVALID_INPUT", "Invalid work item priority");
  if (
    input.contextRefs !== undefined &&
    (!Array.isArray(input.contextRefs) || input.contextRefs.some(invalidReference))
  )
    throw new WorkItemError("INVALID_INPUT", "contextRefs must contain explicit references");
}

function invalidReference(reference: WorkItemContextReference): boolean {
  return (
    !reference ||
    ![
      "file",
      "area",
      "artifact",
      "skill",
      "routine",
      "incoming_signal",
      "integration_event",
    ].includes(reference.kind) ||
    typeof reference.ref !== "string" ||
    !reference.ref.trim()
  );
}
