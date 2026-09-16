import { randomUUID } from "node:crypto";

import type {
  CreateIncomingSignalInput,
  IncomingSignal,
  IncomingSignalProvider,
  IncomingSignalSource,
  IncomingSignalStatus,
  ListIncomingSignalsOptions,
  UpdateIncomingSignalInput,
} from "@/types/incoming-signal";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { getLocalStorePaths, initializeLocalStore } from "../local-store/paths";

const emptySignals: IncomingSignal[] = [];
const sources: IncomingSignalSource[] = ["manual", "email", "integration", "operational"];
const statuses: IncomingSignalStatus[] = ["new", "snoozed", "dismissed", "triaged"];

export class IncomingSignalError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "IncomingSignalError";
  }
}

export class IncomingSignalStore {
  constructor(private readonly root = process.cwd()) {}

  async list(options: ListIncomingSignalsOptions = {}): Promise<IncomingSignal[]> {
    const signals = await this.readSignals();
    return signals
      .filter(
        (signal) =>
          (!options.repositoryId || signal.repositoryId === options.repositoryId) &&
          (!options.source || signal.source === options.source) &&
          (!options.status || signal.status === options.status)
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(input: CreateIncomingSignalInput): Promise<IncomingSignal> {
    validateCreate(input);
    const now = new Date().toISOString();
    const signal: IncomingSignal = {
      id: randomUUID(),
      source: input.source,
      sourceId: input.sourceId?.trim() || null,
      ...(input.provider ? { provider: input.provider } : {}),
      title: input.title.trim(),
      body: input.body?.trim() ?? "",
      repositoryId: input.repositoryId.trim(),
      createdAt: now,
      updatedAt: now,
      status: "new",
      snoozedUntil: null,
      derivedRefs: [],
      ...(input.provenance ? { provenance: input.provenance } : {}),
    };
    await this.writeSignals([signal, ...(await this.readSignals())]);
    return signal;
  }

  async update(
    id: string,
    input: UpdateIncomingSignalInput,
    repositoryId?: string
  ): Promise<IncomingSignal> {
    if (typeof id !== "string" || !id.trim())
      throw new IncomingSignalError("INVALID_INPUT", "id is required");
    validateUpdate(input);
    const signals = await this.readSignals();
    const index = signals.findIndex((signal) => signal.id === id);
    if (index < 0 || (repositoryId && signals[index].repositoryId !== repositoryId))
      throw new IncomingSignalError("NOT_FOUND", "Incoming signal not found.");
    const current = signals[index];
    const updated: IncomingSignal = {
      ...current,
      status: input.status,
      snoozedUntil:
        input.status === "snoozed" ? (input.snoozedUntil ?? current.snoozedUntil) : null,
      derivedRefs: input.derivedRefs ?? current.derivedRefs ?? [],
      updatedAt: new Date().toISOString(),
    };
    signals[index] = updated;
    await this.writeSignals(signals);
    return updated;
  }

  private async readSignals(): Promise<IncomingSignal[]> {
    const paths = await initializeLocalStore(this.root);
    return readJsonFile<IncomingSignal[]>(paths.incomingSignals, emptySignals);
  }

  private async writeSignals(signals: IncomingSignal[]): Promise<void> {
    await writeJsonFile(getLocalStorePaths(this.root).incomingSignals, signals);
  }
}

export const incomingSignalStore = new IncomingSignalStore();

function validateCreate(input: CreateIncomingSignalInput): void {
  if (!input || !sources.includes(input.source))
    throw new IncomingSignalError("INVALID_INPUT", "source must be manual, email, or integration");
  if (typeof input.title !== "string" || !input.title.trim())
    throw new IncomingSignalError("INVALID_INPUT", "title is required");
  if (input.body !== undefined && typeof input.body !== "string")
    throw new IncomingSignalError("INVALID_INPUT", "body must be a string");
  if (typeof input.repositoryId !== "string" || !input.repositoryId.trim())
    throw new IncomingSignalError("INVALID_INPUT", "repositoryId is required");
  if (input.sourceId !== undefined && input.sourceId !== null && typeof input.sourceId !== "string")
    throw new IncomingSignalError("INVALID_INPUT", "sourceId must be a string or null");
  if (
    (input.source === "integration" && !isProvider(input.provider)) ||
    (input.source === "operational" && input.provider !== "local")
  )
    throw new IncomingSignalError(
      "INVALID_INPUT",
      "integration signals require a provider and operational signals require the local provider"
    );
}

function isProvider(value: unknown): value is IncomingSignalProvider {
  return value === "github" || value === "vercel" || value === "sentry";
}

function validateUpdate(input: UpdateIncomingSignalInput): void {
  if (!input || !statuses.includes(input.status))
    throw new IncomingSignalError("INVALID_INPUT", "Invalid incoming signal status");
  if (
    input.snoozedUntil !== undefined &&
    input.snoozedUntil !== null &&
    typeof input.snoozedUntil !== "string"
  )
    throw new IncomingSignalError("INVALID_INPUT", "snoozedUntil must be a string or null");
  if (
    input.derivedRefs !== undefined &&
    (!Array.isArray(input.derivedRefs) ||
      input.derivedRefs.some(
        (reference) =>
          !reference ||
          !["work_item", "skill_run", "artifact"].includes(reference.kind) ||
          typeof reference.ref !== "string" ||
          !reference.ref.trim()
      ))
  )
    throw new IncomingSignalError("INVALID_INPUT", "derivedRefs must contain valid references");
}
