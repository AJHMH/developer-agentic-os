export type OperationalTriggerType = "schedule" | "provider" | "repository";
export type OperationalProvider = "sentry" | "github" | "vercel" | "local";
export type OperationalEvent = {
  id: string;
  repositoryId: string;
  triggerType: OperationalTriggerType;
  provider: OperationalProvider;
  capability: string;
  sourceId: string | null;
  observedAt: string;
  receivedAt: string;
  title: string;
  details: Record<string, unknown>;
  deduplicationKey: string;
  correlationKey: string;
};

export type OperationalIncidentStatus = "active" | "resolved";
export type OperationalIncident = {
  id: string;
  repositoryId: string;
  title: string;
  status: OperationalIncidentStatus;
  eventIds: string[];
  signalIds: string[];
  providers: OperationalProvider[];
  failure?: { message: string; details?: Record<string, unknown> };
  createdAt: string;
  updatedAt: string;
};

export type AutomationTrigger = "schedule" | "provider";
export type AutomationPolicy = {
  id: string;
  repositoryId: string;
  name: string;
  enabled: boolean;
  triggers: AutomationTrigger[];
  workflows: string[];
  requiresApproval: boolean;
  maxRetries: number;
  catchUpWindowMinutes: number;
  scheduleTime?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "awaiting_approval"
  | "retrying"
  | "paused"
  | "cancelled"
  | "missed"
  | "interrupted";
export type AutomationRun = {
  id: string;
  repositoryId: string;
  policyId: string;
  trigger: AutomationTrigger;
  input: Record<string, unknown>;
  status: AutomationRunStatus;
  steps: string[];
  outputs: string[];
  retryCount: number;
  retryHistory: Array<{ attempt: number; at: string; backoffMs: number; error: string }>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  approval: AutomationApproval | null;
  scheduledAt?: string;
  nextAttemptAt?: string;
};

export type AutomationApproval = {
  actor: string;
  approvedAt: string;
  inputFingerprint: string;
  action: string;
};
export type OperationalAuditRecord = {
  id: string;
  repositoryId: string;
  runId: string;
  action: string;
  approval: AutomationApproval;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  recordedAt: string;
};
export type CreateOperationalEventInput = Omit<
  OperationalEvent,
  "id" | "receivedAt" | "deduplicationKey" | "correlationKey"
> & { deduplicationKey?: string; correlationKey?: string };
export type SaveAutomationPolicyInput = Omit<AutomationPolicy, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};
