export type IntegrationStatus =
  | "connected"
  | "healthy"
  | "unhealthy"
  | "unconfigured"
  | "deferred"
  | "available"
  | "disabled"
  | "error";

export type IntegrationAdapterStatus = {
  id: string;
  name: string;
  kind:
    | "local"
    | "scm"
    | "issue-tracker"
    | "chat"
    | "email"
    | "observability"
    | "cloud"
    | "identity"
    | "database";
  required: boolean;
  status: IntegrationStatus;
  capabilities: string[];
  setup?: string;
  message: string;
};
