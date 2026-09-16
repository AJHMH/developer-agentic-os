import type { SignalTriageAction, SignalTriageResult } from "@/types/signal-triage";
import type { IncomingSignal, IncomingSignalDerivedReference } from "@/types/incoming-signal";
import type { WorkspaceContext } from "@/types/workspace";
import { IncomingSignalStore } from "./incoming-signal-store";
import { WorkItemError } from "../work-items/work-item-store";
import { createSkillRegistry } from "../skills/skill-registry";

export class TriageActionError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "TriageActionError";
  }
}

/**
 * Triage action handlers: Each action is independently testable.
 *
 * Handler signature: (context, signal, input) => Promise<SignalTriageResult>
 * Each handler accepts the full SignalTriageAction but performs type narrowing for its action.
 *
 * Benefits:
 * - Each action is isolated and can be tested independently
 * - Easy to add new actions without modifying the orchestrator
 * - Clear responsibilities: each handler knows its constraints and produces a result
 */

async function handleDismiss(
  context: WorkspaceContext,
  signal: IncomingSignal,
  _input: SignalTriageAction
): Promise<SignalTriageResult> {
  const updated = await context.incomingSignalStore.update(
    signal.id,
    { status: "dismissed" },
    signal.repositoryId
  );
  return { action: "dismiss", signal: updated };
}

async function handleSnooze(
  context: WorkspaceContext,
  signal: IncomingSignal,
  input: SignalTriageAction
): Promise<SignalTriageResult> {
  const action = asAction(input, "snooze");
  const snoozedUntil =
    action.snoozedUntil ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const updated = await context.incomingSignalStore.update(
    signal.id,
    { status: "snoozed", snoozedUntil },
    signal.repositoryId
  );
  return { action: "snooze", signal: updated };
}

async function handleCreateWorkItem(
  context: WorkspaceContext,
  signal: IncomingSignal,
  input: SignalTriageAction
): Promise<SignalTriageResult> {
  const action = asAction(input, "create_work_item");
  const signalRef = { kind: "incoming_signal" as const, ref: signal.id, label: signal.title };
  const integrationRef =
    signal.provider && signal.sourceId
      ? { kind: "integration_event" as const, ref: signal.sourceId, label: signal.provider }
      : null;

  let workItem;
  try {
    workItem = await context.workItemStore.create({
      title: action.title?.trim() || signal.title,
      notes: action.notes?.trim() || signal.body,
      priority: action.priority,
      repositoryId: signal.repositoryId,
      contextRefs: [signalRef, ...(integrationRef ? [integrationRef] : [])],
    });
  } catch (error) {
    if (error instanceof WorkItemError) throw new TriageActionError("INVALID_INPUT", error.message);
    throw error;
  }

  const triaged = await markTriaged(signal, context.incomingSignalStore, {
    kind: "work_item",
    ref: workItem.id,
  });
  return { action: "create_work_item", signal: triaged, workItem };
}

async function handleAttachWorkItem(
  context: WorkspaceContext,
  signal: IncomingSignal,
  input: SignalTriageAction
): Promise<SignalTriageResult> {
  const action = asAction(input, "attach_work_item");
  const workItemId = action.workItemId;
  if (!workItemId?.trim()) throw new TriageActionError("INVALID_INPUT", "workItemId is required.");

  const signalRef = { kind: "incoming_signal" as const, ref: signal.id, label: signal.title };
  const matches = await context.workItemStore.list({ repositoryId: signal.repositoryId });
  const workItem = matches.find((item) => item.id === workItemId);

  if (!workItem) throw new TriageActionError("NOT_FOUND", "Work item not found.");

  const alreadyAttached = workItem.contextRefs.some(
    (reference) => reference.kind === "incoming_signal" && reference.ref === signal.id
  );
  const updated = alreadyAttached
    ? workItem
    : await context.workItemStore.update(
        workItem.id,
        { contextRefs: [...workItem.contextRefs, signalRef] },
        signal.repositoryId
      );

  const triaged = await markTriaged(signal, context.incomingSignalStore, {
    kind: "work_item",
    ref: updated.id,
  });
  return { action: "attach_work_item", signal: triaged, workItem: updated };
}

async function handleInvokeSkill(
  context: WorkspaceContext,
  signal: IncomingSignal,
  input: SignalTriageAction
): Promise<SignalTriageResult> {
  const action = asAction(input, "invoke_skill");
  const skillId = action.skillId;
  if (!skillId?.trim()) throw new TriageActionError("INVALID_INPUT", "skillId is required.");

  const signalRef = { kind: "incoming_signal" as const, ref: signal.id, label: signal.title };
  const result = await createSkillRegistry({ context }).runSkill(skillId, action.input ?? {}, {
    workflowRefs: [signalRef],
  });

  const triaged = await markTriaged(signal, context.incomingSignalStore, {
    kind: "skill_run",
    ref: result.run.id,
  });
  return { action: "invoke_skill", signal: triaged, skillRun: result.run };
}

async function handleCreateArtifact(
  context: WorkspaceContext,
  signal: IncomingSignal,
  input: SignalTriageAction
): Promise<SignalTriageResult> {
  const action = asAction(input, "create_artifact");
  const signalRef = { kind: "incoming_signal" as const, ref: signal.id, label: signal.title };

  const artifact = await context.artifactStore.createArtifact({
    name: action.name?.trim() || signal.title,
    type: action.type?.trim() || "signal_triage",
    content: action.content ?? signal.body,
    tags: action.tags ?? ["incoming-signal"],
    contextRefs: [signalRef],
    provenance: {
      repositoryId: signal.repositoryId,
      repositoryRoot: context.root,
      workflowRefs: [signalRef],
    },
  });

  const triaged = await markTriaged(signal, context.incomingSignalStore, {
    kind: "artifact",
    ref: artifact.id,
  });
  return { action: "create_artifact", signal: triaged, artifact };
}

/**
 * Map action types to handler functions.
 */
export const TriageActionHandlers: Record<
  string,
  (
    context: WorkspaceContext,
    signal: IncomingSignal,
    input: SignalTriageAction
  ) => Promise<SignalTriageResult>
> = {
  dismiss: handleDismiss,
  snooze: handleSnooze,
  create_work_item: handleCreateWorkItem,
  attach_work_item: handleAttachWorkItem,
  invoke_skill: handleInvokeSkill,
  create_artifact: handleCreateArtifact,
};

function asAction<TAction extends SignalTriageAction["action"]>(
  action: SignalTriageAction,
  expectedAction: TAction
): Extract<SignalTriageAction, { action: TAction }> {
  if (action.action !== expectedAction)
    throw new TriageActionError("INVALID_INPUT", `Expected action "${expectedAction}".`);
  return action as Extract<SignalTriageAction, { action: TAction }>;
}

/**
 * Mark a signal as triaged with derived references.
 */
async function markTriaged(
  signal: IncomingSignal,
  store: IncomingSignalStore,
  derivedRef: IncomingSignalDerivedReference
) {
  const derivedRefs = signal.derivedRefs.some(
    (ref) => ref.kind === derivedRef.kind && ref.ref === derivedRef.ref
  )
    ? signal.derivedRefs
    : [...signal.derivedRefs, derivedRef];
  return store.update(signal.id, { status: "triaged", derivedRefs }, signal.repositoryId);
}
