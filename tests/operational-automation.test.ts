import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { POST as postEvent, GET as getEvents } from "../src/app/api/operational/events/route";
import { GET as getIncidents } from "../src/app/api/operational/incidents/route";
import { POST as postPolicy, GET as getPolicies } from "../src/app/api/operational/policies/route";
import { OperationalStore } from "../src/server/operational/operational-store";
import { SentryAdapter } from "../src/server/integrations/sentry-adapter";
import { GitHubAdapter } from "../src/server/integrations/github-adapter";
import { VercelAdapter } from "../src/server/integrations/vercel-adapter";
import { createOperationalExecutor } from "../src/server/operational/operational-executor";
import { inputFingerprint } from "../src/server/operational/operational-store";

async function temporaryRepository() {
  return mkdtemp(join(tmpdir(), "developer-agentic-operational-"));
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("operational events normalize, deduplicate, and preserve provenance", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const input = {
      repositoryId: "repo-one",
      triggerType: "provider" as const,
      provider: "sentry" as const,
      capability: "errors",
      sourceId: "issue-42",
      observedAt: "2026-09-06T10:00:00.000Z",
      title: "Checkout failure",
      details: { environment: "production" },
    };
    const first = await store.ingestEvent(input);
    const duplicate = await store.ingestEvent({ ...input, observedAt: "2026-09-06T10:01:00.000Z" });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.event.id, first.event.id);
    assert.equal((await store.listEvents({ repositoryId: "repo-one" })).length, 1);
    assert.equal(first.event.deduplicationKey, "sentry:errors:issue-42");
    assert.equal(first.event.repositoryId, "repo-one");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operational store serializes concurrent writes per repository root", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.ingestEvent({
          repositoryId: "repo-one",
          triggerType: "provider",
          provider: "local",
          capability: "test",
          sourceId: `event-${index}`,
          observedAt: "2026-09-06T10:00:00.000Z",
          title: `Event ${index}`,
          details: {},
        })
      )
    );
    assert.equal((await store.listEvents({ repositoryId: "repo-one" })).length, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("related events are grouped without replacing source evidence", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const first = await store.ingestEvent({
      repositoryId: "repo-one",
      triggerType: "provider",
      provider: "github",
      capability: "actions",
      sourceId: "run-1",
      observedAt: "2026-09-06T10:00:00.000Z",
      title: "Build failed",
      details: { workflow: "ci" },
      correlationKey: "checkout",
    });
    const second = await store.ingestEvent({
      repositoryId: "repo-one",
      triggerType: "provider",
      provider: "vercel",
      capability: "deployments",
      sourceId: "deployment-1",
      observedAt: "2026-09-06T10:02:00.000Z",
      title: "Deploy failed",
      details: { branch: "main" },
      correlationKey: "checkout",
    });
    const incident = await store.groupEvent(first.event);
    const sameIncident = await store.groupEvent(second.event);
    assert.equal(sameIncident.id, incident.id);
    assert.deepEqual(sameIncident.eventIds, [first.event.id, second.event.id]);
    const listed = await store.listIncidents({ repositoryId: "repo-one" });
    assert.equal(listed[0]?.events.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("policies reject credentials and remain repository scoped", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    await assert.rejects(() =>
      store.savePolicy({
        repositoryId: "repo-one",
        name: "Unsafe",
        enabled: true,
        triggers: ["schedule"],
        workflows: ["repo-summary"],
        requiresApproval: false,
        maxRetries: 1,
        catchUpWindowMinutes: 30,
        credentials: { token: "secret" },
      } as never)
    );
    const policy = await store.savePolicy({
      repositoryId: "repo-one",
      name: "Health",
      enabled: true,
      triggers: ["schedule", "provider"],
      workflows: ["repo-summary"],
      requiresApproval: true,
      maxRetries: 2,
      catchUpWindowMinutes: 60,
    });
    assert.equal(policy.repositoryId, "repo-one");
    assert.equal((await store.listPolicies({ repositoryId: "repo-two" })).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operational routes reject unknown repository contexts and malformed events", async () => {
  const malformed = await postEvent(
    new Request("http://localhost/api/operational/events", { method: "POST", body: "{}" })
  );
  assert.equal(malformed.status, 400);
  const missing = await getEvents(
    new Request("http://localhost/api/operational/events?repositoryId=missing-context")
  );
  assert.equal(missing.status, 404);
  const missingIncident = await getIncidents(
    new Request("http://localhost/api/operational/incidents?repositoryId=missing-context")
  );
  assert.equal(missingIncident.status, 404);
  const missingPolicies = await getPolicies(
    new Request("http://localhost/api/operational/policies?repositoryId=missing-context")
  );
  assert.equal(missingPolicies.status, 404);
  const invalidPolicy = await postPolicy(
    new Request("http://localhost/api/operational/policies", {
      method: "POST",
      body: JSON.stringify({ repositoryId: "missing-context", name: "Health" }),
    })
  );
  assert.equal(invalidPolicy.status, 404);
  assert.match(JSON.stringify(await responseBody(invalidPolicy)), /Repository context not found/);
});

test("Sentry fixture adapter is read-only and distinguishes provider failures", async () => {
  const adapter = new SentryAdapter(
    {
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "org",
      SENTRY_PROJECT: "app",
      SENTRY_API_URL: "http://fixture",
    },
    async (input, init) => {
      assert.equal(init?.method, undefined);
      assert.match(input, /projects\/org\/app\/issues/);
      return new Response(
        JSON.stringify([
          { id: "issue-1", title: "Boom", lastSeen: "2026-09-06T10:00:00.000Z", count: "3" },
        ])
      );
    }
  );
  const observations = await adapter.getObservations();
  assert.equal(observations[0]?.state, "unhealthy");
  assert.equal(observations[0]?.sourceId, "issue-1");
  const unconfigured = await new SentryAdapter({
    SENTRY_AUTH_TOKEN: "token",
    SENTRY_PROJECT: "app",
  }).getObservations();
  assert.equal(unconfigured[0]?.state, "unconfigured");
  assert.deepEqual(unconfigured[0]?.details.reason, "missing_configuration");
});

test("Sentry reports an explicit healthy observation when no issues are returned", async () => {
  const adapter = new SentryAdapter(
    {
      SENTRY_AUTH_TOKEN: "token",
      SENTRY_ORG: "org",
      SENTRY_PROJECT: "app",
      SENTRY_API_URL: "http://fixture",
    },
    async () => new Response("[]")
  );
  const observations = await adapter.getObservations();
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.state, "healthy");
});

test("run actions enforce status and invalidate approval when input changes", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const run = await store.createRun({
      repositoryId: "repo-one",
      policyId: "policy",
      trigger: "provider",
      input: { deploymentId: "old" },
      status: "awaiting_approval",
      steps: [],
      outputs: [],
      error: null,
    });
    const approved = await store.approveRun(run.id, "repo-one", {
      actor: "test",
      approvedAt: new Date().toISOString(),
      inputFingerprint: inputFingerprint(run.input),
      action: "vercel-redeploy",
    });
    await assert.rejects(() =>
      store.approveRun(run.id, "repo-one", {
        actor: "test",
        approvedAt: new Date().toISOString(),
        inputFingerprint: inputFingerprint(run.input),
        action: "vercel-redeploy",
      })
    );
    const changed = await store.updateRun(approved.id, "repo-one", {
      input: { deploymentId: "new" },
    });
    assert.equal(changed.approval, null);
    await assert.rejects(() =>
      store.approveRun(changed.id, "repo-one", {
        actor: "test",
        approvedAt: new Date().toISOString(),
        inputFingerprint: inputFingerprint(run.input),
        action: "vercel-redeploy",
      })
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider actions preserve response bodies and require Vercel project identity", async () => {
  const github = new GitHubAdapter(
    { GITHUB_TOKEN: "token", GITHUB_REPOSITORY: "owner/repo" },
    async () => new Response(JSON.stringify({ queued: true }), { status: 201 })
  );
  const githubResult = await github.rerunFailedAction("42");
  assert.deepEqual(githubResult.response.body, { queued: true });
  const vercel = new VercelAdapter(
    { VERCEL_TOKEN: "token", VERCEL_PROJECT_ID: "project" },
    async () => new Response(JSON.stringify({ redeployed: true }), { status: 200 })
  );
  assert.equal((await vercel.redeploy("dep")).status, 400);
  const vercelResult = await vercel.redeploy("dep", "project");
  assert.deepEqual(vercelResult.response.body, { redeployed: true });
});

test("executor honors maxRetries and links final failure to an incident signal", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const policy = await store.savePolicy({
      repositoryId: "repo-one",
      name: "Broken workflow",
      enabled: true,
      triggers: ["provider"],
      workflows: ["missing-workflow"],
      requiresApproval: false,
      maxRetries: 1,
      catchUpWindowMinutes: 60,
    });
    const run = await createOperationalExecutor(root).runPolicy(policy.id, "repo-one", "provider", {
      source: "test",
    });
    assert.equal(run?.status, "failed");
    assert.equal(run?.retryCount, 1);
    const incidents = await store.listIncidents({ repositoryId: "repo-one" });
    assert.equal(incidents[0]?.signalIds.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retry backoff records the next attempt time", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const policy = await store.savePolicy({
      repositoryId: "repo-one",
      name: "Retry",
      enabled: true,
      triggers: ["provider"],
      workflows: ["missing-workflow"],
      requiresApproval: false,
      maxRetries: 1,
      catchUpWindowMinutes: 60,
    });
    const run = await store.createRun({
      repositoryId: "repo-one",
      policyId: policy.id,
      trigger: "provider",
      input: {},
      status: "failed",
      steps: [],
      outputs: [],
      error: "failure",
    });
    const retried = await store.retryRun(run.id, "repo-one", "failure", 60_000);
    assert.ok(retried.nextAttemptAt);
    assert.ok(Date.parse(retried.nextAttemptAt as string) > Date.now());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operational executor records approval and global pause states", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const policy = await store.savePolicy({
      repositoryId: "repo-one",
      name: "Daily summary",
      enabled: true,
      triggers: ["schedule"],
      workflows: ["repo-summary"],
      requiresApproval: true,
      maxRetries: 1,
      catchUpWindowMinutes: 60,
    });
    const executor = createOperationalExecutor(root);
    const waiting = await executor.runPolicy(policy.id, "repo-one");
    assert.equal(waiting?.status, "awaiting_approval");
    await store.setGlobalPause(true);
    const paused = await executor.runPolicy(policy.id, "repo-one");
    assert.equal(paused?.status, "paused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global pause is shared by repository stores and stale schedule occurrences are recorded", async () => {
  const root = await temporaryRepository();
  const otherRoot = await temporaryRepository();
  const workspaceRoot = await temporaryRepository();
  try {
    const first = new OperationalStore(root, workspaceRoot);
    const second = new OperationalStore(otherRoot, workspaceRoot);
    await first.setGlobalPause(true);
    assert.equal(await second.isGlobalPaused(), true);
    await first.setGlobalPause(false);
    const policy = await first.savePolicy({
      repositoryId: "repo-one",
      name: "Stale",
      enabled: true,
      triggers: ["schedule"],
      workflows: ["repo-summary"],
      requiresApproval: false,
      maxRetries: 0,
      catchUpWindowMinutes: 1,
      scheduleTime: "00:00",
    });
    const result = await createOperationalExecutor(root, workspaceRoot).runDueSchedule("repo-one");
    assert.equal(result, 0);
    assert.equal(
      (await first.listRuns({ repositoryId: "repo-one" })).find((run) => run.policyId === policy.id)
        ?.status,
      "missed"
    );
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(otherRoot, { recursive: true, force: true }),
      rm(workspaceRoot, { recursive: true, force: true }),
    ]);
  }
});

test("all configured workflows execute and exhausted failures retain operational provenance", async () => {
  const root = await temporaryRepository();
  try {
    const store = new OperationalStore(root);
    const policy = await store.savePolicy({
      repositoryId: "repo-one",
      name: "Multiple workflows",
      enabled: true,
      triggers: ["provider"],
      workflows: ["repo-summary", "missing-workflow"],
      requiresApproval: false,
      maxRetries: 0,
      catchUpWindowMinutes: 60,
    });
    const run = await createOperationalExecutor(root).runPolicy(policy.id, "repo-one", "provider", {
      eventId: "event-1",
      incidentId: "incident-1",
    });
    assert.equal(run?.status, "failed");
    assert.deepEqual(run?.steps, ["repo-summary"]);
    const signal = (await import("../src/server/incoming-signals/incoming-signal-store"))
      .IncomingSignalStore;
    const signals = await new signal(root).list({ repositoryId: "repo-one" });
    assert.equal(signals[0]?.source, "operational");
    assert.deepEqual(signals[0]?.provenance, {
      eventId: (await store.listEvents({ repositoryId: "repo-one" }))[0]?.id,
      incidentId: (await store.listIncidents({ repositoryId: "repo-one" }))[0]?.id,
      runId: run?.id,
      policyId: policy.id,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
