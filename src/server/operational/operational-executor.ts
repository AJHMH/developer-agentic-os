import { createSkillRegistry } from "../skills/skill-registry";
import { IncomingSignalStore } from "../incoming-signals/incoming-signal-store";
import { OperationalStore } from "./operational-store";

export function createOperationalExecutor(root = process.cwd(), workspaceRoot = root) {
  const store = new OperationalStore(root, workspaceRoot);
  async function recoverInterruptedRuns(repositoryId?: string): Promise<number> {
    const runs = await store.listRuns({ repositoryId });
    const interrupted = runs.filter((run) => run.status === "running");
    for (const run of interrupted)
      await store.updateRun(run.id, run.repositoryId, {
        status: "interrupted",
        error: "Run was interrupted before the background executor restarted.",
      });
    return interrupted.length;
  }

  async function runPolicy(
    policyId: string,
    repositoryId: string,
    trigger: "schedule" | "provider" = "schedule",
    input: Record<string, unknown> = {}
  ) {
    const policy = (await store.listPolicies({ repositoryId })).find(
      (item) => item.id === policyId
    );
    if (!policy) throw new Error("Automation policy not found.");
    if (!policy.enabled || !policy.triggers.includes(trigger)) return null;
    const run = await store.createRun({
      repositoryId,
      policyId,
      trigger,
      input,
      status:
        (await store.isGlobalPaused()) || (await store.isPolicyPaused(policy.id))
          ? "paused"
          : policy.requiresApproval
            ? "awaiting_approval"
            : "queued",
      steps: [],
      outputs: [],
      error: null,
    });
    if (run.status !== "queued") return run;
    await store.transitionRun(run.id, repositoryId, "running");
    while (true) {
      const outputs: string[] = [];
      const completedSteps: string[] = [];
      let thrownError: string | null = null;
      const workflowRefs = [
        { kind: "policy" as const, ref: policy.id, label: policy.name },
        ...(typeof input.eventId === "string"
          ? [{ kind: "operational_event" as const, ref: input.eventId, label: "Operational event" }]
          : []),
        ...(typeof input.incidentId === "string"
          ? [
              {
                kind: "operational_incident" as const,
                ref: input.incidentId,
                label: "Operational incident",
              },
            ]
          : []),
      ];
      try {
        for (const workflow of policy.workflows) {
          const skillResult = await createSkillRegistry({ root }).runSkill(
            workflow,
            {},
            { workflowRefs }
          );
          completedSteps.push(workflow);
          if (skillResult.status !== "succeeded")
            throw new Error(skillResult.run.error ?? `Workflow ${workflow} failed.`);
          if (skillResult.run.artifactId) outputs.push(skillResult.run.artifactId);
        }
      } catch (error) {
        thrownError = error instanceof Error ? error.message : "Automation workflow failed.";
      }
      if (!thrownError)
        return store.updateRun(run.id, repositoryId, {
          status: "succeeded",
          steps: completedSteps,
          outputs,
          error: null,
        });
      const error = thrownError;
      const current = await store.updateRun(run.id, repositoryId, {
        status: "failed",
        steps: completedSteps,
        outputs,
        error,
      });
      if (current.retryCount < policy.maxRetries) {
        const backoffMs = 1_000 * 2 ** current.retryCount;
        const retrying = await store.retryRun(run.id, repositoryId, error, backoffMs);
        if (retrying.nextAttemptAt && Date.parse(retrying.nextAttemptAt) > Date.now())
          await new Promise((resolve) =>
            setTimeout(resolve, Date.parse(retrying.nextAttemptAt as string) - Date.now())
          );
        await store.transitionRun(run.id, repositoryId, "queued");
        await store.transitionRun(run.id, repositoryId, "running");
        continue;
      }
      const eventResult = await store.ingestEvent({
        repositoryId,
        triggerType: "provider",
        provider: "local",
        capability: "automation",
        sourceId: run.id,
        observedAt: new Date().toISOString(),
        title: `${policy.name} automation failed`,
        details: { failure: true, runId: run.id, policyId: policy.id, error },
        correlationKey: `automation:${run.id}`,
      });
      const incident = await store.groupEvent(eventResult.event);
      const signal = await new IncomingSignalStore(root).create({
        source: "operational",
        provider: "local",
        sourceId: `automation:${run.id}`,
        title: incident.title,
        body: error,
        repositoryId,
        provenance: {
          eventId: eventResult.event.id,
          incidentId: incident.id,
          runId: run.id,
          policyId: policy.id,
        },
      });
      await store.attachSignal(incident.id, repositoryId, signal.id);
      return current;
    }
  }

  return {
    runPolicy,
    async runDueSchedule(repositoryId: string): Promise<number> {
      await recoverInterruptedRuns(repositoryId);
      if (await store.isGlobalPaused()) return 0;
      const now = new Date();
      let executed = 0;
      for (const policy of await store.listPolicies({ repositoryId })) {
        if (!policy.enabled || !policy.triggers.includes("schedule")) continue;
        const scheduleTime = policy.scheduleTime ?? "00:00";
        const [hours, minutes] = scheduleTime.split(":").map(Number);
        const firstDay = new Date(now.getTime() - policy.catchUpWindowMinutes * 60_000);
        firstDay.setUTCHours(0, 0, 0, 0);
        const runs = await store.listRuns({ repositoryId });
        for (const day = new Date(firstDay); day <= now; day.setUTCDate(day.getUTCDate() + 1)) {
          const occurrence = new Date(day);
          occurrence.setUTCHours(hours, minutes, 0, 0);
          if (occurrence > now) continue;
          const scheduledAt = occurrence.toISOString();
          const existing = runs.find(
            (run) =>
              run.policyId === policy.id &&
              run.trigger === "schedule" &&
              run.status !== "interrupted" &&
              run.scheduledAt === scheduledAt
          );
          if (existing) continue;
          if (now.getTime() - occurrence.getTime() > policy.catchUpWindowMinutes * 60_000) {
            await store.createRun({
              repositoryId,
              policyId: policy.id,
              trigger: "schedule",
              input: { scheduledAt },
              status: "missed",
              steps: [],
              outputs: [],
              error: "Schedule catch-up window elapsed.",
            });
          } else {
            await runPolicy(policy.id, repositoryId, "schedule", { scheduledAt });
            executed += 1;
          }
        }
      }
      return executed;
    },
  };
}
