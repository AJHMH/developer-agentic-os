import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { GET as getContext, PUT as setContext } from "../src/app/api/workspace/context/route";
import { DELETE as deleteRepository } from "../src/app/api/workspace/repositories/[id]/route";
import {
  GET as listRepositories,
  POST as registerRepository,
} from "../src/app/api/workspace/repositories/route";
import { WorkspaceError, WorkspaceStore } from "../src/server/workspace/workspace-store";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("workspace store registers repositories with stable ids and persists the active context", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-workspace-"));
  const repository = await mkdtemp(join(tmpdir(), "developer-agentic-os-repository-"));
  try {
    const store = new WorkspaceStore(root);
    const registered = await store.registerRepository(repository);
    const repeated = await store.registerRepository(resolve(repository, "."));

    assert.equal(repeated.id, registered.id);
    assert.deepEqual(await store.getActiveContext(), registered);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, ".developer-agentic-os", "workspace.json"), "utf8")),
      {
        repositories: [registered],
        activeRepositoryId: registered.id,
      }
    );

    const restored = new WorkspaceStore(root);
    assert.equal((await restored.getActiveContext()).id, registered.id);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(repository, { recursive: true, force: true });
  }
});

test("workspace store preserves cwd fallback and rejects invalid paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-workspace-"));
  try {
    const store = new WorkspaceStore(root);
    const fallback = await store.getActiveContext();
    assert.equal(fallback.path, resolve(root));
    await assert.rejects(
      () => store.registerRepository(join(root, "missing")),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceError);
        assert.equal(error.code, "INVALID_PATH");
        return true;
      }
    );
    const file = join(root, "not-a-directory.txt");
    await writeFile(file, "file", "utf8");
    await assert.rejects(() => store.registerRepository(file), /must be a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace routes expose fallback context and validate active selection", async () => {
  const context = await getContext();
  const contextBody = await responseBody(context);
  assert.equal(context.status, 200);
  assert.equal(typeof (contextBody.context as { id: string }).id, "string");

  const missing = await setContext(
    new Request("http://localhost/api/workspace/context", {
      method: "PUT",
      body: JSON.stringify({ id: "missing" }),
    })
  );
  assert.equal(missing.status, 404);

  const invalid = await registerRepository(
    new Request("http://localhost/api/workspace/repositories", {
      method: "POST",
      body: JSON.stringify({ path: "C:\\definitely-missing-workspace" }),
    })
  );
  assert.equal(invalid.status, 400);

  const repositories = await listRepositories();
  assert.equal(repositories.status, 200);
  assert.ok(Array.isArray((await responseBody(repositories)).repositories));
});

test("repository route includes git availability and recent activity for switching", async () => {
  const response = await listRepositories();
  const body = await responseBody(response);
  const repositories = body.repositories as Array<{
    git: { available: boolean; recentCommits: string[] };
  }>;
  assert.ok(repositories.every((repository) => typeof repository.git.available === "boolean"));
  assert.ok(repositories.every((repository) => Array.isArray(repository.git.recentCommits)));
});

test("deleting an unknown repository returns a clear route error", async () => {
  const response = await deleteRepository(
    new Request("http://localhost/api/workspace/repositories/missing", { method: "DELETE" }),
    {
      params: Promise.resolve({ id: "missing" }),
    }
  );
  assert.equal(response.status, 404);
});
