import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type {
  AutomationApproval,
  AutomationPolicy,
  AutomationRun,
  CreateOperationalEventInput,
  OperationalAuditRecord,
  OperationalEvent,
  OperationalIncident,
  SaveAutomationPolicyInput,
} from "@/types/operational";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { getLocalStorePaths, initializeLocalStore } from "../local-store/paths";

type OperationalState = {
  events: OperationalEvent[];
  incidents: OperationalIncident[];
  policies: AutomationPolicy[];
  runs: AutomationRun[];
  audits: OperationalAuditRecord[];
  globalPaused: boolean;
  pausedPolicies: string[];
};
const emptyState: OperationalState = {
  events: [],
  incidents: [],
  policies: [],
  runs: [],
  audits: [],
  globalPaused: false,
  pausedPolicies: [],
};

export class OperationalStoreError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "OperationalStoreError";
  }
}

export class OperationalStore {
  private static readonly locks = new Map<string, Promise<void>>();
  constructor(
    private readonly root = process.cwd(),
    private readonly workspaceRoot = root
  ) {}

  async ingestEvent(
    input: CreateOperationalEventInput
  ): Promise<{ event: OperationalEvent; created: boolean }> {
    validateEvent(input);
    return this.mutate(async (state) => {
      const deduplicationKey =
        input.deduplicationKey?.trim() ||
        `${input.provider}:${input.capability}:${input.sourceId?.trim() || input.title.trim().toLowerCase()}`;
      const existing = state.events.find(
        (event) =>
          event.repositoryId === input.repositoryId && event.deduplicationKey === deduplicationKey
      );
      if (existing) return { event: existing, created: false };
      const event: OperationalEvent = {
        ...input,
        id: randomUUID(),
        sourceId: input.sourceId?.trim() || null,
        title: input.title.trim(),
        details: input.details ?? {},
        receivedAt: new Date().toISOString(),
        deduplicationKey,
        correlationKey: input.correlationKey?.trim() || deduplicationKey,
      };
      state.events.unshift(event);
      return { event, created: true };
    });
  }

  async listEvents(options: { repositoryId?: string } = {}): Promise<OperationalEvent[]> {
    return (await this.read()).events.filter(
      (event) => !options.repositoryId || event.repositoryId === options.repositoryId
    );
  }

  async groupEvent(event: OperationalEvent): Promise<OperationalIncident> {
    return this.mutate(async (state) => {
      let incident = state.incidents.find(
        (item) =>
          item.repositoryId === event.repositoryId &&
          item.eventIds.some(
            (id) =>
              state.events.find((candidate) => candidate.id === id)?.correlationKey ===
              event.correlationKey
          )
      );
      const now = new Date().toISOString();
      if (!incident) {
        incident = {
          id: randomUUID(),
          repositoryId: event.repositoryId,
          title: event.title,
          status: "active",
          eventIds: [],
          signalIds: [],
          providers: [],
          createdAt: now,
          updatedAt: now,
        };
        state.incidents.unshift(incident);
      }
      if (event.details.failure === true || typeof event.details.error === "string")
        incident.failure = {
          message: typeof event.details.error === "string" ? event.details.error : event.title,
          details: event.details,
        };
      if (!incident.eventIds.includes(event.id)) incident.eventIds.push(event.id);
      if (!incident.providers.includes(event.provider)) incident.providers.push(event.provider);
      incident.updatedAt = now;
      return incident;
    });
  }

  async listIncidents(
    options: { repositoryId?: string } = {}
  ): Promise<Array<OperationalIncident & { events: OperationalEvent[] }>> {
    const state = await this.read();
    return state.incidents
      .filter((incident) => !options.repositoryId || incident.repositoryId === options.repositoryId)
      .map((incident) => ({
        ...incident,
        events: incident.eventIds
          .map((id) => state.events.find((event) => event.id === id))
          .filter((event): event is OperationalEvent => Boolean(event)),
      }));
  }
  async attachSignal(
    incidentId: string,
    repositoryId: string,
    signalId: string
  ): Promise<OperationalIncident> {
    return this.mutate(async (state) => {
      const incident = state.incidents.find(
        (item) => item.id === incidentId && item.repositoryId === repositoryId
      );
      if (!incident)
        throw new OperationalStoreError("NOT_FOUND", "Operational incident not found.");
      if (!incident.signalIds.includes(signalId)) incident.signalIds.push(signalId);
      incident.updatedAt = new Date().toISOString();
      return incident;
    });
  }

  async savePolicy(input: SaveAutomationPolicyInput): Promise<AutomationPolicy> {
    validatePolicy(input);
    return this.mutate(async (state) => {
      const now = new Date().toISOString();
      const current = input.id
        ? state.policies.find(
            (policy) => policy.id === input.id && policy.repositoryId === input.repositoryId
          )
        : undefined;
      const policy: AutomationPolicy = {
        ...input,
        id: current?.id ?? input.id ?? randomUUID(),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      state.policies = [policy, ...state.policies.filter((item) => item.id !== policy.id)];
      return policy;
    });
  }

  async listPolicies(options: { repositoryId?: string } = {}): Promise<AutomationPolicy[]> {
    return (await this.read()).policies.filter(
      (policy) => !options.repositoryId || policy.repositoryId === options.repositoryId
    );
  }

  async createRun(
    input: Omit<
      AutomationRun,
      "id" | "createdAt" | "updatedAt" | "retryCount" | "retryHistory" | "approval"
    >
  ): Promise<AutomationRun> {
    if (!input.repositoryId || !input.policyId || !input.trigger)
      throw new OperationalStoreError(
        "INVALID_INPUT",
        "repositoryId, policyId, and trigger are required"
      );
    const now = new Date().toISOString();
    const run: AutomationRun = {
      ...input,
      id: randomUUID(),
      retryCount: 0,
      retryHistory: [],
      approval: null,
      scheduledAt:
        typeof input.input.scheduledAt === "string" ? input.input.scheduledAt : undefined,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate(async (state) => {
      state.runs.unshift(run);
      return run;
    });
  }

  async listRuns(options: { repositoryId?: string } = {}): Promise<AutomationRun[]> {
    return (await this.read()).runs.filter(
      (run) => !options.repositoryId || run.repositoryId === options.repositoryId
    );
  }
  async updateRun(
    id: string,
    repositoryId: string,
    patch: Partial<Pick<AutomationRun, "status" | "steps" | "outputs" | "error" | "input">>
  ): Promise<AutomationRun> {
    return this.mutate(async (state) => {
      const index = state.runs.findIndex(
        (run) => run.id === id && run.repositoryId === repositoryId
      );
      if (index < 0) throw new OperationalStoreError("NOT_FOUND", "Automation run not found.");
      const current = state.runs[index];
      const inputChanged =
        patch.input !== undefined &&
        inputFingerprint(patch.input) !== inputFingerprint(current.input);
      const run = {
        ...current,
        ...patch,
        scheduledAt:
          typeof patch.input?.scheduledAt === "string"
            ? patch.input.scheduledAt
            : current.scheduledAt,
        approval: inputChanged ? null : current.approval,
        updatedAt: new Date().toISOString(),
      };
      state.runs[index] = run;
      return run;
    });
  }
  async transitionRun(
    id: string,
    repositoryId: string,
    status: AutomationRun["status"]
  ): Promise<AutomationRun> {
    return this.mutate(async (state) => {
      const index = state.runs.findIndex(
        (run) => run.id === id && run.repositoryId === repositoryId
      );
      if (index < 0) throw new OperationalStoreError("NOT_FOUND", "Automation run not found.");
      const current = state.runs[index];
      const allowed: Record<AutomationRun["status"], AutomationRun["status"][]> = {
        queued: ["running", "paused", "cancelled", "missed"],
        running: ["succeeded", "failed", "retrying", "paused", "cancelled", "interrupted"],
        retrying: ["queued", "failed", "cancelled", "paused"],
        paused: ["queued", "cancelled"],
        awaiting_approval: ["queued", "cancelled"],
        succeeded: [],
        failed: [],
        cancelled: [],
        missed: [],
        interrupted: [],
      };
      if (!allowed[current.status].includes(status))
        throw new OperationalStoreError(
          "CONFLICT",
          `Cannot transition run from ${current.status} to ${status}.`
        );
      state.runs[index] = {
        ...current,
        status,
        nextAttemptAt: status === "queued" ? undefined : current.nextAttemptAt,
        updatedAt: new Date().toISOString(),
      };
      return state.runs[index];
    });
  }
  async retryRun(
    id: string,
    repositoryId: string,
    error: string,
    backoffMs: number
  ): Promise<AutomationRun> {
    return this.mutate(async (state) => {
      const index = state.runs.findIndex(
        (run) => run.id === id && run.repositoryId === repositoryId
      );
      const current = index >= 0 ? state.runs[index] : undefined;
      if (!current) throw new OperationalStoreError("NOT_FOUND", "Automation run not found.");
      if (current.status !== "failed")
        throw new OperationalStoreError("CONFLICT", "Only failed runs can be retried.");
      const policy = state.policies.find(
        (item) => item.id === current.policyId && item.repositoryId === repositoryId
      );
      if (!policy || current.retryCount >= policy.maxRetries)
        throw new OperationalStoreError("CONFLICT", "Policy retry budget is exhausted.");
      const delay = Math.max(0, backoffMs);
      const updated = {
        ...current,
        status: "retrying" as const,
        retryCount: current.retryCount + 1,
        retryHistory: [
          ...current.retryHistory,
          {
            attempt: current.retryCount + 1,
            at: new Date().toISOString(),
            backoffMs: delay,
            error,
          },
        ],
        error,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.runs[index] = updated;
      return updated;
    });
  }
  async setGlobalPause(paused: boolean): Promise<boolean> {
    const paths = await initializeLocalStore(this.workspaceRoot);
    const key = resolve(this.workspaceRoot);
    const previous = OperationalStore.locks.get(`workspace:${key}`) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const queued = previous.then(() => current);
    OperationalStore.locks.set(`workspace:${key}`, queued);
    await previous;
    try {
      await writeJsonFile(paths.workspaceOperational, { globalPaused: paused });
      return paused;
    } finally {
      release();
      if (OperationalStore.locks.get(`workspace:${key}`) === queued)
        OperationalStore.locks.delete(`workspace:${key}`);
    }
  }
  async isGlobalPaused(): Promise<boolean> {
    const paths = await initializeLocalStore(this.workspaceRoot);
    return (
      (await readJsonFile<{ globalPaused?: boolean }>(paths.workspaceOperational, {}))
        .globalPaused ?? false
    );
  }
  async setPolicyPause(policyId: string, paused: boolean): Promise<boolean> {
    return this.mutate(async (state) => {
      const pausedPolicies = new Set(state.pausedPolicies ?? []);
      if (paused) pausedPolicies.add(policyId);
      else pausedPolicies.delete(policyId);
      state.pausedPolicies = [...pausedPolicies];
      return paused;
    });
  }
  async isPolicyPaused(policyId: string): Promise<boolean> {
    return (await this.read()).pausedPolicies?.includes(policyId) ?? false;
  }
  async approveRun(
    id: string,
    repositoryId: string,
    approval: AutomationApproval
  ): Promise<AutomationRun> {
    return this.mutate(async (state) => {
      const index = state.runs.findIndex(
        (run) => run.id === id && run.repositoryId === repositoryId
      );
      if (index < 0) throw new OperationalStoreError("NOT_FOUND", "Automation run not found.");
      const current = state.runs[index];
      if (current.status !== "awaiting_approval")
        throw new OperationalStoreError("CONFLICT", "Only runs awaiting approval can be approved.");
      if (approval.inputFingerprint !== inputFingerprint(current.input))
        throw new OperationalStoreError(
          "CONFLICT",
          "Approval does not match the current run input."
        );
      const run = {
        ...current,
        approval,
        status: "queued" as const,
        updatedAt: new Date().toISOString(),
      };
      state.runs[index] = run;
      return run;
    });
  }
  async recordAudit(
    record: Omit<OperationalAuditRecord, "id" | "recordedAt">
  ): Promise<OperationalAuditRecord> {
    return this.mutate(async (state) => {
      const audit = { ...record, id: randomUUID(), recordedAt: new Date().toISOString() };
      state.audits.unshift(audit);
      return audit;
    });
  }
  async listAudits(
    options: { repositoryId?: string; runId?: string } = {}
  ): Promise<OperationalAuditRecord[]> {
    return (await this.read()).audits.filter(
      (audit) =>
        (!options.repositoryId || audit.repositoryId === options.repositoryId) &&
        (!options.runId || audit.runId === options.runId)
    );
  }
  private async read(): Promise<OperationalState> {
    const paths = await initializeLocalStore(this.root);
    const state = await readJsonFile<OperationalState>(paths.operational, emptyState);
    return {
      ...emptyState,
      ...state,
      events: [...(state.events ?? [])],
      incidents: [...(state.incidents ?? [])],
      policies: [...(state.policies ?? [])],
      runs: [...(state.runs ?? [])],
      audits: [...(state.audits ?? [])],
      pausedPolicies: [...(state.pausedPolicies ?? [])],
    };
  }
  private async write(state: OperationalState): Promise<void> {
    await writeJsonFile(getLocalStorePaths(this.root).operational, state);
  }
  private async mutate<T>(operation: (state: OperationalState) => Promise<T> | T): Promise<T> {
    const key = resolve(this.root);
    const previous = OperationalStore.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const queued = previous.then(() => current);
    OperationalStore.locks.set(key, queued);
    await previous;
    try {
      const state = await this.read();
      const result = await operation(state);
      await this.write(state);
      return result;
    } finally {
      release();
      if (OperationalStore.locks.get(key) === queued) OperationalStore.locks.delete(key);
    }
  }
}

function validateEvent(input: CreateOperationalEventInput): void {
  if (!input || !input.repositoryId?.trim())
    throw new OperationalStoreError("INVALID_INPUT", "repositoryId is required");
  if (!["schedule", "provider", "repository"].includes(input.triggerType))
    throw new OperationalStoreError("INVALID_INPUT", "triggerType is invalid");
  if (!["sentry", "github", "vercel", "local"].includes(input.provider))
    throw new OperationalStoreError("INVALID_INPUT", "provider is invalid");
  if (!input.capability?.trim() || !input.title?.trim())
    throw new OperationalStoreError("INVALID_INPUT", "capability and title are required");
  if (Number.isNaN(Date.parse(input.observedAt)))
    throw new OperationalStoreError("INVALID_INPUT", "observedAt must be a valid timestamp");
  if (!input.details || typeof input.details !== "object" || Array.isArray(input.details))
    throw new OperationalStoreError("INVALID_INPUT", "details must be an object");
}

function validatePolicy(input: SaveAutomationPolicyInput): void {
  if (!input.repositoryId?.trim() || !input.name?.trim())
    throw new OperationalStoreError("INVALID_INPUT", "repositoryId and name are required");
  if (
    !input.triggers.length ||
    input.triggers.some((trigger) => !["schedule", "provider"].includes(trigger))
  )
    throw new OperationalStoreError("INVALID_INPUT", "triggers must contain schedule or provider");
  if (!input.workflows.length || input.workflows.some((workflow) => !workflow.trim()))
    throw new OperationalStoreError("INVALID_INPUT", "at least one workflow is required");
  if (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10)
    throw new OperationalStoreError("INVALID_INPUT", "maxRetries must be between 0 and 10");
  if (
    !Number.isInteger(input.catchUpWindowMinutes) ||
    input.catchUpWindowMinutes < 0 ||
    input.catchUpWindowMinutes > 1_440
  )
    throw new OperationalStoreError(
      "INVALID_INPUT",
      "catchUpWindowMinutes must be between 0 and 1440"
    );
  if (input.scheduleTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.scheduleTime))
    throw new OperationalStoreError("INVALID_INPUT", "scheduleTime must use HH:mm UTC format");
  if ("credentials" in input)
    throw new OperationalStoreError("INVALID_INPUT", "policies cannot contain credentials");
}

export function inputFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(input, Object.keys(input).sort()))
    .digest("hex");
}
