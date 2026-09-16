import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GET, POST } from "../src/app/api/work-items/route";
import { PATCH } from "../src/app/api/work-items/[id]/route";
import { WorkItemStore } from "../src/server/work-items/work-item-store";
import { GET as getContext } from "../src/app/api/workspace/context/route";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("work item store persists repository-scoped items and status history", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-work-items-"));
  try {
    const store = new WorkItemStore(root);
    const item = await store.create({
      title: "Ship queue",
      notes: "Keep it local",
      priority: "high",
      repositoryId: "repo-a",
      contextRefs: [{ kind: "file", ref: "src/app/page.tsx" }],
    });
    const completed = await store.update(item.id, { status: "completed" });

    assert.equal((await store.list({ repositoryId: "repo-b" })).length, 0);
    assert.equal(completed.completedAt !== null, true);
    assert.deepEqual(
      completed.statusHistory.map((change) => change.status),
      ["open", "completed"]
    );
    assert.equal((await new WorkItemStore(root).list({ repositoryId: "repo-a" }))[0]?.id, item.id);
    await assert.rejects(
      () => store.update(item.id, { status: "blocked" }, "repo-b"),
      /Work item not found/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("work item routes create, filter, update, and validate ids", async () => {
  const contextBody = (await getContext().then(responseBody)) as { context: { id: string } };
  const created = await POST(
    new Request("http://localhost/api/work-items", {
      method: "POST",
      body: JSON.stringify({ title: "Route item", repositoryId: contextBody.context.id }),
    })
  );
  assert.equal(created.status, 201);
  const item = (await responseBody(created)) as { id: string };

  const filtered = await GET(
    new Request(
      `http://localhost/api/work-items?repositoryId=${contextBody.context.id}&status=open`
    )
  );
  assert.equal((await responseBody(filtered)).workItems instanceof Array, true);
  const updated = await PATCH(
    new Request(`http://localhost/api/work-items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "blocked" }),
    }),
    { params: Promise.resolve({ id: item.id }) }
  );
  assert.equal(((await responseBody(updated)) as { status: string }).status, "blocked");

  const invalid = await POST(
    new Request("http://localhost/api/work-items", {
      method: "POST",
      body: JSON.stringify({ title: "Missing repository" }),
    })
  );
  assert.equal(invalid.status, 400);
  const missing = await PATCH(
    new Request("http://localhost/api/work-items/missing", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  assert.equal(missing.status, 404);
});

test("work item patch rejects an empty body", async () => {
  const response = await PATCH(
    new Request("http://localhost/api/work-items/missing", { method: "PATCH" }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  assert.equal(response.status, 400);
});
