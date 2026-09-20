# src/types/operational.ts

- OperationalTriggerType · type · L1-L1 — type OperationalTriggerType = "schedule" | "provider" | "repository";
- OperationalProvider · type · L2-L2 — type OperationalProvider = "sentry" | "github" | "vercel" | "local";
- OperationalEvent · type · L3-L16 — type OperationalEvent = { id: string; repositoryId: string; triggerType: OperationalTriggerType; provider: OperationalProvider; capability: string; sourceId: string | null; observedAt: string; receivedAt: string; title: string; details: Record<string, unknown>; deduplicationKey: string; correlationKey: string; };
- OperationalIncidentStatus · type · L18-L18 — type OperationalIncidentStatus = "active" | "resolved";
- OperationalIncident · type · L19-L30 — type OperationalIncident = { id: string; repositoryId: string; title: string; status: OperationalIncidentStatus; eventIds: string[]; signalIds: string[]; providers: OperationalProvider[]; failure?: { message: string; details?: Record<string, unknown> }; createdAt: string; updatedAt: string; };
- AutomationTrigger · type · L32-L32 — type AutomationTrigger = "schedule" | "provider";
- AutomationPolicy · type · L33-L46 — type AutomationPolicy = { id: string; repositoryId: string; name: string; enabled: boolean; triggers: AutomationTrigger[]; workflows: string[]; requiresApproval: boolean; maxRetries: number; catchUpWindowMinutes: number; scheduleTime?: string; createdAt: string; updatedAt: string; };
- AutomationRunStatus · type · L48-L58 — type AutomationRunStatus = | "queued" | "running" | "succeeded" | "failed" | "awaiting_approval" | "retrying" | "paused" | "cancelled" | "missed" | "interrupted";
- AutomationRun · type · L59-L76 — type AutomationRun = { id: string; repositoryId: string; policyId: string; trigger: AutomationTrigger; input: Record<string, unknown>; status: AutomationRunStatus; steps: string[]; outputs: string[]; retryCount: number; retryHistory: Array<{ attempt: number; at: string; backoffMs: number; error: string }>; error: string | null; createdAt: string; updatedAt: string; approval: AutomationApproval | null; scheduledAt?: string; nextAttemptAt?: string; };
- AutomationApproval · type · L78-L83 — type AutomationApproval = { actor: string; approvedAt: string; inputFingerprint: string; action: string; };
- OperationalAuditRecord · type · L84-L93 — type OperationalAuditRecord = { id: string; repositoryId: string; runId: string; action: string; approval: AutomationApproval; request: Record<string, unknown>; response: Record<string, unknown>; recordedAt: string; };
- CreateOperationalEventInput · type · L94-L97 — type CreateOperationalEventInput = Omit< OperationalEvent, "id" | "receivedAt" | "deduplicationKey" | "correlationKey" > & { deduplicationKey?: string; correlationKey?: string };
- SaveAutomationPolicyInput · type · L98-L100 — type SaveAutomationPolicyInput = Omit<AutomationPolicy, "id" | "createdAt" | "updatedAt"> & { id?: string; };
