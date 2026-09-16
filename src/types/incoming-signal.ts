export type IncomingSignalSource = "manual" | "email" | "integration" | "operational";
export type IncomingSignalProvider = "github" | "vercel" | "sentry" | "local";
export type IncomingSignalStatus = "new" | "snoozed" | "dismissed" | "triaged";
export type IncomingSignalDerivedReference = {
  kind: "work_item" | "skill_run" | "artifact";
  ref: string;
};
export type IncomingSignalProvenance = {
  eventId?: string;
  incidentId?: string;
  runId?: string;
  policyId?: string;
};

export type IncomingSignal = {
  id: string;
  source: IncomingSignalSource;
  sourceId: string | null;
  provider?: IncomingSignalProvider;
  title: string;
  body: string;
  repositoryId: string;
  createdAt: string;
  updatedAt: string;
  status: IncomingSignalStatus;
  snoozedUntil: string | null;
  derivedRefs: IncomingSignalDerivedReference[];
  provenance?: IncomingSignalProvenance;
};

export type CreateIncomingSignalInput = {
  source: IncomingSignalSource;
  sourceId?: string | null;
  provider?: IncomingSignalProvider;
  title: string;
  body?: string;
  repositoryId: string;
  provenance?: IncomingSignalProvenance;
};

export type ListIncomingSignalsOptions = {
  repositoryId?: string;
  source?: IncomingSignalSource;
  status?: IncomingSignalStatus;
};

export type UpdateIncomingSignalInput = {
  status: IncomingSignalStatus;
  snoozedUntil?: string | null;
  derivedRefs?: IncomingSignalDerivedReference[];
};
