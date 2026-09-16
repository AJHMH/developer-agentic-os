import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { POST as triage } from "../src/app/api/incoming-signals/[id]/triage/route";
import { IncomingSignalStore } from "../src/server/incoming-signals/incoming-signal-store";
import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { workspaceStore } from "../src/server/workspace/workspace-store";

type TriageResponse = {
  signal: { status: string; sourceId?: string | null };
  workItem?: {
    id: string;
    title: string;
    contextRefs: Array<{ kind: string; ref: string; label?: string }>;
  };
  skillRun?: { status: string; artifactId: string };
  artifact?: { provenance: { workflowRefs: Array<{ kind: string; ref: string }> } };
};

async function readBody(response: Response): Promise<TriageResponse> {
  return response.json() as Promise<TriageResponse>;
}

function request(root: string, action: Record<string, unknown>): Request {
  return new Request("http://localhost/api/incoming-signals/triage", {
    method: "POST",
    body: JSON.stringify({ ...action, repositoryRoot: root }),
  });
}

test("triage actions create and link workflow records without losing the source signal", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-triage-"));
  let contextId = "";
  try {
    const context = await workspaceStore.registerRepository(root);
    contextId = context.id;
    const signal = await new IncomingSignalStore(root).create({
      source: "integration",
      provider: "github",
      sourceId: "github:octo/example:authentication",
      title: "GitHub integration unhealthy",
      body: "Signal body",
      repositoryId: context.id,
    });
    const created = await triage(
      request(root, { action: "create_work_item", title: "Linked item" }),
      { params: Promise.resolve({ id: signal.id }) }
    );
    assert.equal(created.status, 200);
    const createdBody = await readBody(created);
    assert.ok(createdBody.workItem);
    assert.equal(createdBody.signal.status, "triaged");
    assert.deepEqual(createdBody.workItem.contextRefs[0], {
      kind: "incoming_signal",
      ref: signal.id,
      label: signal.title,
    });
    assert.deepEqual(createdBody.workItem.contextRefs[1], {
      kind: "integration_event",
      ref: signal.sourceId,
      label: "github",
    });

    const attached = await triage(
      request(root, { action: "attach_work_item", workItemId: createdBody.workItem.id }),
      { params: Promise.resolve({ id: signal.id }) }
    );
    const attachedBody = await readBody(attached);
    assert.ok(attachedBody.workItem);
    assert.equal(
      attachedBody.workItem.contextRefs.filter((reference) => reference.ref === signal.id).length,
      1
    );

    const skillSignal = await new IncomingSignalStore(root).create({
      source: "email",
      title: "Run skill",
      body: "Skill body",
      repositoryId: context.id,
    });
    const skill = await triage(request(root, { action: "invoke_skill", skillId: "repo-summary" }), {
      params: Promise.resolve({ id: skillSignal.id }),
    });
    const skillBody = await readBody(skill);
    assert.ok(skillBody.skillRun);
    assert.equal(skillBody.skillRun.status, "succeeded");
    const skillArtifact = await new ArtifactStore(root).getArtifact(skillBody.skillRun.artifactId);
    assert.ok(
      skillArtifact?.provenance?.workflowRefs.some(
        (reference) => reference.kind === "incoming_signal" && reference.ref === skillSignal.id
      )
    );

    const artifactSignal = await new IncomingSignalStore(root).create({
      source: "manual",
      title: "Make artifact",
      body: "Artifact body",
      repositoryId: context.id,
    });
    const artifact = await triage(request(root, { action: "create_artifact", type: "note" }), {
      params: Promise.resolve({ id: artifactSignal.id }),
    });
    const artifactBody = await readBody(artifact);
    assert.ok(artifactBody.artifact);
    assert.equal(artifactBody.artifact.provenance.workflowRefs[0].ref, artifactSignal.id);

    const snoozeSignal = await new IncomingSignalStore(root).create({
      source: "manual",
      title: "Snooze me",
      repositoryId: context.id,
    });
    const snoozed = await triage(
      request(root, { action: "snooze", snoozedUntil: "2030-01-01T00:00:00.000Z" }),
      { params: Promise.resolve({ id: snoozeSignal.id }) }
    );
    assert.equal((await readBody(snoozed)).signal.status, "snoozed");
    const dismissedSignal = await new IncomingSignalStore(root).create({
      source: "manual",
      title: "Dismiss me",
      repositoryId: context.id,
    });
    const dismissed = await triage(request(root, { action: "dismiss" }), {
      params: Promise.resolve({ id: dismissedSignal.id }),
    });
    assert.equal((await readBody(dismissed)).signal.status, "dismissed");
  } finally {
    await workspaceStore.removeRepository(contextId).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("triage rejects invalid actions and cross-repository signal access", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "developer-agentic-os-triage-source-"));
  const otherRoot = await mkdtemp(join(tmpdir(), "developer-agentic-os-triage-other-"));
  let sourceContextId = "";
  let otherContextId = "";
  try {
    const sourceContext = await workspaceStore.registerRepository(sourceRoot);
    const otherContext = await workspaceStore.registerRepository(otherRoot);
    sourceContextId = sourceContext.id;
    otherContextId = otherContext.id;
    const signal = await new IncomingSignalStore(sourceRoot).create({
      source: "manual",
      title: "Private signal",
      repositoryId: sourceContext.id,
    });
    const invalid = await triage(request(sourceRoot, { action: "unknown" }), {
      params: Promise.resolve({ id: signal.id }),
    });
    assert.equal(invalid.status, 400);
    const crossRepository = await triage(request(otherRoot, { action: "dismiss" }), {
      params: Promise.resolve({ id: signal.id }),
    });
    assert.equal(crossRepository.status, 404);
    assert.equal(
      (await new IncomingSignalStore(sourceRoot).list({ repositoryId: sourceContextId }))[0].status,
      "new"
    );
  } finally {
    await workspaceStore.removeRepository(sourceContextId).catch(() => undefined);
    await workspaceStore.removeRepository(otherContextId).catch(() => undefined);
    await rm(sourceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(otherRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
