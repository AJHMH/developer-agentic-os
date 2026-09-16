import type { IntegrationStatus } from "./integration";

export type VercelFailureKind =
  "authentication" | "rate_limit" | "not_found" | "timeout" | "unavailable" | "invalid_response";

export type VercelFailure = { kind: VercelFailureKind; message: string };

export type VercelDeployment = {
  id: string;
  name: string;
  url: string;
  state: "ready" | "building" | "error" | "queued" | "unknown";
  target: string | null;
  createdAt: string;
  buildLogUrl: string;
  runtimeLogUrl: string;
};

export type VercelOperations = {
  status: IntegrationStatus;
  projectId: string | null;
  message: string;
  deployments: VercelDeployment[];
  failure: VercelFailure | null;
  checkedAt: string;
};
