# src/types/integration.ts

- IntegrationStatus · type · L1-L9 — type IntegrationStatus = | "connected" | "healthy" | "unhealthy" | "unconfigured" | "deferred" | "available" | "disabled" | "error";
- IntegrationCategory · type · L11-L11 — type IntegrationCategory = "connected" | "configurable" | "deferred";
- IntegrationAdapterStatus · type · L13-L33 — type IntegrationAdapterStatus = { id: string; name: string; kind: | "local" | "scm" | "issue-tracker" | "chat" | "email" | "observability" | "cloud" | "identity" | "database"; category: IntegrationCategory; required: boolean; status: IntegrationStatus; capabilities: string[]; setup?: string; message: string; configSnippet?: string; };
