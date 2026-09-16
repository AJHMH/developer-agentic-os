import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { POST as createHandoff, GET as listHandoffs } from "../src/app/api/handoffs/route";
import { PATCH as updateHandoff } from "../src/app/api/handoffs/[id]/route";
import { POST as finalizeHandoff } from "../src/app/api/handoffs/[id]/finalize/route";
import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { HandoffError, HandoffStore } from "../src/server/handoffs/handoff-store";
import { WorkItemStore } from "../src/server/work-items/work-item-store";
import { repositoryId } from "../src/server/workspace/repository-context";
import { workspaceStore } from "../src/server/workspace/workspace-store";
import type { RepositoryContext } from "../src/types/workspace";

function context(path: string): RepositoryContext {
  return { id: repositoryId(path), name: path.split(/[\\/]/).at(-1) ?? path, path: resolve(path) };
}

test("handoff store captures editable context and finalizes an immutable artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-handoff-"));
  try {
    const repository = context(root);
    const workItems = new WorkItemStore(root);
    await workItems.create({
      repositoryId: repository.id,
      title: "Carry the session forward",
      status: "in_progress",
    });
    const store = new HandoffStore(root);
    const draft = await store.create(repository, {
      title: "Friday handoff",
      decisions: ["Keep the local store"],
      blockers: ["Needs review"],
      nextActions: ["Run the browser suite"],
    });

    assert.equal(draft.status, "draft");
    assert.equal(draft.snapshot.repositoryContext.id, repository.id);
    assert.equal(draft.snapshot.workItems[0]?.title, "Carry the session forward");
    const edited = await store.update(
      draft.id,
      { nextActions: ["Ship the handoff"] },
      repository.id
    );
    assert.deepEqual(edited.nextActions, ["Ship the handoff"]);

    const finalized = await store.finalize(draft.id, repository.id);
    assert.equal(finalized.status, "finalized");
    assert.ok(finalized.artifactId);
    const artifact = await new ArtifactStore(root).getArtifact(finalized.artifactId as string);
    assert.equal(artifact?.type, "session_handoff");
    assert.deepEqual((artifact?.content as { nextActions: string[] }).nextActions, [
      "Ship the handoff",
    ]);

    await assert.rejects(
      () => store.update(draft.id, { title: "Changed after finalization" }, repository.id),
      (error: unknown) => error instanceof HandoffError && error.code === "FINALIZED"
    );
    const again = await store.finalize(draft.id, repository.id);
    assert.equal(again.artifactId, finalized.artifactId);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("handoff routes create, edit, list, finalize, and reject finalized edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-handoff-route-"));
  const repository = await workspaceStore.registerRepository(root);
  try {
    const create = await createHandoff(
      new Request(`http://localhost/api/handoffs?repositoryRoot=${encodeURIComponent(root)}`, {
        method: "POST",
        body: JSON.stringify({ title: "Route handoff" }),
      })
    );
    assert.equal(create.status, 201);
    const draft = (await create.json()) as {
      id: string;
      snapshot: { repositoryContext: { id: string } };
    };
    assert.equal(draft.snapshot.repositoryContext.id, repository.id);

    const listed = await listHandoffs(
      new Request(`http://localhost/api/handoffs?repositoryId=${repository.id}`)
    );
    assert.equal(listed.status, 200);
    assert.equal(((await listed.json()) as { handoffs: unknown[] }).handoffs.length, 1);
    const edited = await updateHandoff(
      new Request(`http://localhost/api/handoffs?repositoryId=${repository.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nextActions: ["Review"] }),
      }),
      { params: Promise.resolve({ id: draft.id }) }
    );
    assert.equal(edited.status, 200);
    const finalized = await finalizeHandoff(
      new Request(`http://localhost/api/handoffs?repositoryId=${repository.id}`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: draft.id }) }
    );
    assert.equal(finalized.status, 200);
    const rejected = await updateHandoff(
      new Request(`http://localhost/api/handoffs?repositoryId=${repository.id}`, {
        method: "PATCH",
        body: JSON.stringify({ blockers: ["No"] }),
      }),
      { params: Promise.resolve({ id: draft.id }) }
    );
    assert.equal(rejected.status, 409);
  } finally {
    await workspaceStore.removeRepository(repository.id);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
