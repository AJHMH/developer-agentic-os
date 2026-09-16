import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { resetLocalStore } from "../src/server/local-store/paths";

test("artifact store initializes local store and lists newest artifacts first", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-artifacts-"));
  try {
    const store = new ArtifactStore(root);
    await store.initialize();

    const first = await store.createArtifact({
      name: "First",
      type: "note",
      content: "one",
      tags: ["alpha"],
    });
    const second = await store.createArtifact({
      name: "Second",
      type: "summary",
      content: { ok: true },
      tags: ["beta"],
    });

    const index = JSON.parse(
      await readFile(join(root, ".developer-agentic-os", "artifacts", "index.json"), "utf8")
    );
    assert.equal(index.artifacts.length, 2);

    const artifacts = await store.listArtifacts({ limit: 2 });
    assert.deepEqual(
      artifacts.map((artifact) => artifact.id),
      [second.id, first.id]
    );
    assert.equal((await store.getArtifact(second.id))?.name, "Second");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact store filters artifacts and rejects unsafe ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-artifacts-"));
  try {
    const store = new ArtifactStore(root);
    await store.createArtifact({
      name: "Digest",
      type: "summary",
      content: "digest",
      tags: ["weekly"],
    });
    await store.createArtifact({
      name: "Checklist",
      type: "checklist",
      content: "todo",
      tags: ["work"],
    });

    assert.equal((await store.listArtifacts({ type: "summary" })).length, 1);
    assert.equal((await store.listArtifacts({ tag: "work" })).length, 1);
    assert.equal(await store.getArtifact("../index"), null);
    assert.equal(await store.getArtifact("not a safe id"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact stores isolate repositories and read legacy entries without provenance", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "developer-agentic-os-artifacts-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "developer-agentic-os-artifacts-b-"));
  try {
    const first = new ArtifactStore(firstRoot);
    const second = new ArtifactStore(secondRoot);
    const created = await first.createArtifact({
      name: "First repo",
      type: "note",
      content: "one",
    });
    assert.equal((await second.listArtifacts()).length, 0);
    assert.equal((await first.getArtifact(created.id))?.repositoryRoot, firstRoot);
    assert.equal(
      (await first.getArtifact(created.id))?.provenance?.repositoryId,
      (await first.getArtifact(created.id))?.repositoryId
    );

    const legacyIndex = {
      artifacts: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          name: "Legacy",
          type: "note",
          tags: [],
          contextRefs: [],
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    await writeFile(
      join(secondRoot, ".developer-agentic-os", "artifacts", "index.json"),
      JSON.stringify(legacyIndex),
      "utf8"
    );
    assert.equal((await second.listArtifacts())[0]?.name, "Legacy");
    assert.equal((await second.listArtifacts())[0]?.repositoryId, undefined);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("local store reset is clean and first-build safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-reset-"));
  try {
    const store = new ArtifactStore(root);
    await store.createArtifact({ name: "Transient", type: "note", content: "remove me" });
    const paths = await resetLocalStore(root);
    assert.equal((await store.listArtifacts()).length, 0);
    assert.equal(paths.root, root);
    assert.equal((await new ArtifactStore(root).listArtifacts()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
