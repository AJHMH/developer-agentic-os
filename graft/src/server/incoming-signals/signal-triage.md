# src/server/incoming-signals/signal-triage.ts

- SignalTriageError · class · L6-L14 — class SignalTriageError extends Error
- constructor · method · L7-L13 — constructor( readonly code: "INVALID_INPUT" | "NOT_FOUND", message: string )
- triageSignal · function · L23-L38 — async function triageSignal( context: WorkspaceContext, signalId: string, input: SignalTriageAction, repositoryId: string ): Promise<SignalTriageResult>
