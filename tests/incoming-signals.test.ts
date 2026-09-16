import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GET, POST } from "../src/app/api/incoming-signals/route";
import { PATCH } from "../src/app/api/incoming-signals/[id]/route";
import { IncomingSignalStore } from "../src/server/incoming-signals/incoming-signal-store";
import { recordIntegrationFailure } from "../src/server/incoming-signals/integration-failure";
import { GET as getContext } from "../src/app/api/workspace/context/route";

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("signal store persists, filters, isolates repositories, and clears snooze metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-signals-"));
  try {
    const store = new IncomingSignalStore(root);
    const signal = await store.create({
      source: "manual",
      title: "Review inbox",
      body: "A note",
      repositoryId: "repo-a",
      sourceId: "note-1",
    });
    assert.equal(signal.status, "new");
    const snoozed = await store.update(
      signal.id,
      { status: "snoozed", snoozedUntil: "2030-01-01T00:00:00.000Z" },
      "repo-a"
    );
    assert.equal(snoozed.snoozedUntil, "2030-01-01T00:00:00.000Z");
    const triaged = await store.update(signal.id, { status: "triaged" }, "repo-a");
    assert.equal(triaged.snoozedUntil, null);
    assert.equal((await store.list({ repositoryId: "repo-b" })).length, 0);
    assert.equal(
      (await new IncomingSignalStore(root).list({ source: "manual" }))[0]?.id,
      signal.id
    );
    await assert.rejects(
      () => store.update(signal.id, { status: "dismissed" }, "repo-b"),
      /Incoming signal not found/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signal routes create, filter, transition statuses, and validate ids", async () => {
  const context = (await getContext().then(json)) as { context: { id: string } };
  const title = `Route signal ${Date.now()}`;
  const created = await POST(
    new Request("http://localhost/api/incoming-signals", {
      method: "POST",
      body: JSON.stringify({
        source: "email",
        title,
        body: "Demo email",
        repositoryId: context.context.id,
        sourceId: "email-1",
      }),
    })
  );
  assert.equal(created.status, 201);
  const signal = (await json(created)) as { id: string; source: string };
  assert.equal(signal.source, "email");

  const filtered = await GET(
    new Request(
      `http://localhost/api/incoming-signals?repositoryId=${context.context.id}&source=email&status=new`
    )
  );
  assert.ok((await json(filtered)).signals instanceof Array);
  const updated = await PATCH(
    new Request(`http://localhost/api/incoming-signals/${signal.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    }),
    { params: Promise.resolve({ id: signal.id }) }
  );
  assert.equal(((await json(updated)) as { status: string }).status, "dismissed");

  const invalidStatus = await PATCH(
    new Request(`http://localhost/api/incoming-signals/${signal.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "unknown" }),
    }),
    { params: Promise.resolve({ id: signal.id }) }
  );
  assert.equal(invalidStatus.status, 400);
  const missing = await PATCH(
    new Request("http://localhost/api/incoming-signals/missing", {
      method: "PATCH",
      body: JSON.stringify({ status: "triaged" }),
    }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  assert.equal(missing.status, 404);
});

test("integration failures create one repository-scoped signal per provider event", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-integration-signals-"));
  try {
    const input = {
      provider: "github",
      sourceId: "github:octo/example:authentication:rejected",
      title: "GitHub integration unhealthy",
      body: "GitHub credentials were rejected.",
      repositoryId: "repo-a",
    };
    const [first, second] = await Promise.all([
      recordIntegrationFailure(root, input),
      recordIntegrationFailure(root, input),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(first.source, "integration");
    assert.equal(first.provider, "github");
    assert.equal(
      (await new IncomingSignalStore(root).list({ repositoryId: "repo-a", source: "integration" }))
        .length,
      1
    );
    await recordIntegrationFailure(root, { ...input, repositoryId: "repo-b" });
    assert.equal(
      (await new IncomingSignalStore(root).list({ repositoryId: "repo-b", source: "integration" }))
        .length,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
