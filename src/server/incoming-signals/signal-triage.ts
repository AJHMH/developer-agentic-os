import type { SignalTriageAction, SignalTriageResult } from "@/types/signal-triage";
import type { WorkspaceContext } from "@/types/workspace";
import { TriageOrchestrator } from "./triage-orchestrator";
import { TriageActionError } from "./triage-action-handlers";

export class SignalTriageError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "SignalTriageError";
  }
}

/**
 * Triage an incoming signal by applying an action (dismiss, snooze, create work item, etc.)
 * Receives WorkspaceContext with injected stores; does not create stores internally.
 *
 * Uses TriageOrchestrator internally to coordinate action handlers while maintaining
 * a backward-compatible public API.
 */
export async function triageSignal(
  context: WorkspaceContext,
  signalId: string,
  input: SignalTriageAction,
  repositoryId: string
): Promise<SignalTriageResult> {
  const orchestrator = new TriageOrchestrator(context);
  try {
    return await orchestrator.runTriage(signalId, input, repositoryId);
  } catch (error) {
    if (error instanceof TriageActionError) {
      throw new SignalTriageError(error.code, error.message);
    }
    throw error;
  }
}
