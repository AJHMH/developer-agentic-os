# src/types/integration.ts

- IntegrationStatus · type · L1-L9 — type IntegrationStatus = | "connected" | "healthy" | "unhealthy" | "unconfigured" | "deferred" | "available" | "disabled" | "error";
- IntegrationAdapterStatus · type · L11-L29 — type IntegrationAdapterStatus = { id: string; name: string; kind: | "local" | "scm" | "issue-tracker" | "chat" | "email" | "observability" | "cloud" | "identity" | "database"; required: boolean; status: IntegrationStatus; capabilities: string[]; setup?: string; message: string; };
