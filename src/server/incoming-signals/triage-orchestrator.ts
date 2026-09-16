import type { SignalTriageAction, SignalTriageResult } from "@/types/signal-triage";
import type { WorkspaceContext } from "@/types/workspace";
import { TriageActionHandlers, TriageActionError } from "./triage-action-handlers";

/**
 * TriageOrchestrator: Deep module coordinating signal triage workflow.
 *
 * Responsibilities:
 * - Validate triage actions
 * - Look up signals
 * - Dispatch to appropriate action handler
 * - Handle errors consistently
 *
 * Dependencies (injected):
 * - WorkspaceContext (containing stores)
 * - TriageActionHandlers (the action functions)
 *
 * Benefits:
 * - All orchestration logic in one place
 * - Handlers are pure and testable independently
 * - Easy to add new actions without changing orchestrator
 * - Clear error handling strategy
 */
export class TriageOrchestrator {
  constructor(private context: WorkspaceContext) {}

  /**
   * Triage a signal by applying an action.
   */
  async runTriage(
    signalId: string,
    input: SignalTriageAction,
    repositoryId: string
  ): Promise<SignalTriageResult> {
    // Validate the action
    this.validateAction(input);

    // Look up the signal
    const signalStore = this.context.incomingSignalStore;
    const signal = (await signalStore.list({ repositoryId })).find((item) => item.id === signalId);
    if (!signal) throw new TriageActionError("NOT_FOUND", "Incoming signal not found.");

    // Dispatch to the appropriate handler
    const handler = TriageActionHandlers[input.action];
    if (!handler)
      throw new TriageActionError("INVALID_INPUT", `Unknown triage action: ${input.action}`);

    return handler(this.context, signal, input);
  }

  /**
   * Validate a triage action object.
   */
  private validateAction(input: SignalTriageAction): void {
    const validActions = Object.keys(TriageActionHandlers);

    if (!input || typeof input !== "object" || !validActions.includes(input.action)) {
      throw new TriageActionError(
        "INVALID_INPUT",
        `Invalid signal triage action. Must be one of: ${validActions.join(", ")}`
      );
    }

    // Action-specific validation
    if (
      input.action === "attach_work_item" &&
      (!input.workItemId || typeof input.workItemId !== "string")
    ) {
      throw new TriageActionError("INVALID_INPUT", "attach_work_item requires workItemId.");
    }

    if (input.action === "invoke_skill" && (!input.skillId || typeof input.skillId !== "string")) {
      throw new TriageActionError("INVALID_INPUT", "invoke_skill requires skillId.");
    }

    if (input.action === "create_artifact") {
      if (
        input.tags !== undefined &&
        (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))
      ) {
        throw new TriageActionError("INVALID_INPUT", "tags must be an array of strings.");
      }
    }

    if (input.action === "snooze" && input.snoozedUntil !== undefined) {
      if (typeof input.snoozedUntil !== "string" || Number.isNaN(Date.parse(input.snoozedUntil))) {
        throw new TriageActionError(
          "INVALID_INPUT",
          "snoozedUntil must be a valid ISO date string."
        );
      }
    }
  }
}
