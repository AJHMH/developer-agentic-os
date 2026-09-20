# src/types/incoming-signal.ts

- IncomingSignalSource · type · L1-L1 — type IncomingSignalSource = "manual" | "email" | "integration" | "operational";
- IncomingSignalProvider · type · L2-L2 — type IncomingSignalProvider = "github" | "vercel" | "sentry" | "local";
- IncomingSignalStatus · type · L3-L3 — type IncomingSignalStatus = "new" | "snoozed" | "dismissed" | "triaged";
- IncomingSignalDerivedReference · type · L4-L7 — type IncomingSignalDerivedReference = { kind: "work_item" | "skill_run" | "artifact"; ref: string; };
- IncomingSignalProvenance · type · L8-L13 — type IncomingSignalProvenance = { eventId?: string; incidentId?: string; runId?: string; policyId?: string; };
- IncomingSignal · type · L15-L29 — type IncomingSignal = { id: string; source: IncomingSignalSource; sourceId: string | null; provider?: IncomingSignalProvider; title: string; body: string; repositoryId: string; createdAt: string; updatedAt: string; status: IncomingSignalStatus; snoozedUntil: string | null; derivedRefs: IncomingSignalDerivedReference[]; provenance?: IncomingSignalProvenance; };
- CreateIncomingSignalInput · type · L31-L39 — type CreateIncomingSignalInput = { source: IncomingSignalSource; sourceId?: string | null; provider?: IncomingSignalProvider; title: string; body?: string; repositoryId: string; provenance?: IncomingSignalProvenance; };
- ListIncomingSignalsOptions · type · L41-L45 — type ListIncomingSignalsOptions = { repositoryId?: string; source?: IncomingSignalSource; status?: IncomingSignalStatus; };
- UpdateIncomingSignalInput · type · L47-L51 — type UpdateIncomingSignalInput = { status: IncomingSignalStatus; snoozedUntil?: string | null; derivedRefs?: IncomingSignalDerivedReference[]; };
