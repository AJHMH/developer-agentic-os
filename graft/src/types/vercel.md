# src/types/vercel.ts

- VercelFailureKind · type · L3-L4 — type VercelFailureKind = "authentication" | "rate_limit" | "not_found" | "timeout" | "unavailable" | "invalid_response";
- VercelFailure · type · L6-L6 — type VercelFailure = { kind: VercelFailureKind; message: string };
- VercelDeployment · type · L8-L17 — type VercelDeployment = { id: string; name: string; url: string; state: "ready" | "building" | "error" | "queued" | "unknown"; target: string | null; createdAt: string; buildLogUrl: string; runtimeLogUrl: string; };
- VercelOperations · type · L19-L26 — type VercelOperations = { status: IntegrationStatus; projectId: string | null; message: string; deployments: VercelDeployment[]; failure: VercelFailure | null; checkedAt: string; };
