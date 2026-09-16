import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { HandoffStore } from "../src/server/handoffs/handoff-store";
import { IncomingSignalStore } from "../src/server/incoming-signals/incoming-signal-store";
import { resetLocalStore } from "../src/server/local-store/paths";
import { buildSecondBrainGraph } from "../src/server/second-brain/second-brain-graph";
import { refreshRepoMemorySnapshot } from "../src/server/repo-memory/repo-memory";
import { WorkItemStore } from "../src/server/work-items/work-item-store";
import { repositoryId } from "../src/server/workspace/repository-context";
import type { GraphLinkType, GraphNodeType } from "../src/types/second-brain";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-graph-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n", "utf8");
  await writeFile(join(root, "CONTEXT.md"), "# Context\n", "utf8");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

test("second brain graph contains repo, area, file, artifact, and skill nodes", async () => {
  const root = await createGitRepo();
  try {
    await refreshRepoMemorySnapshot(root);
    const artifact = await new ArtifactStore(root).createArtifact({
      name: "Repo Summary",
      type: "repo_summary",
      content: "summary",
      tags: ["repo-summary"],
      contextRefs: [{ kind: "file", ref: "README.md" }],
      provenance: {
        repositoryId: repositoryId(root),
        repositoryRoot: root,
        workflowRefs: [{ kind: "skill", ref: "repo-summary" }],
      },
    });

    const graph = await buildSecondBrainGraph(root);
    const nodeTypes = new Set(graph.nodes.map((node) => node.type));
    assert.deepEqual(
      (["repo", "area", "file", "artifact", "skill"] as GraphNodeType[]).every((type) =>
        nodeTypes.has(type)
      ),
      true
    );
    assert.ok(graph.nodes.some((node) => node.id === `artifact:${artifact.id}`));
    assert.ok(graph.nodes.some((node) => node.id === "skill:repo-summary"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("second brain graph includes contains, references, produced, and used_context links", async () => {
  const root = await createGitRepo();
  try {
    await refreshRepoMemorySnapshot(root);
    await new ArtifactStore(root).createArtifact({
      name: "Repo Summary",
      type: "repo_summary",
      content: "summary",
      tags: ["repo-summary"],
      contextRefs: [{ kind: "file", ref: "README.md" }],
      provenance: {
        repositoryId: repositoryId(root),
        repositoryRoot: root,
        workflowRefs: [{ kind: "skill", ref: "repo-summary" }],
      },
    });

    const graph = await buildSecondBrainGraph(root);
    const linkTypes = new Set(graph.links.map((link) => link.type));
    for (const type of ["contains", "produced", "used_context"] as GraphLinkType[]) {
      assert.equal(linkTypes.has(type), true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("second brain graph connects durable work items, routines, and workflow provenance", async () => {
  const root = await createGitRepo();
  try {
    await refreshRepoMemorySnapshot(root);
    const workItem = await new WorkItemStore(root).create({
      title: "Ship graph",
      repositoryId: repositoryId(root),
      contextRefs: [{ kind: "file", ref: "README.md" }],
    });
    const registry = (
      await import("../src/server/routines/routine-registry")
    ).createRoutineRegistry({ root });
    const routineRun = await registry.runRoutine("nightly_repo_digest", {
      source: "local_background",
    });
    const graph = await buildSecondBrainGraph(root);
    const nodeTypes = new Set(graph.nodes.map((node) => node.type));
    assert.equal(nodeTypes.has("work_item"), true);
    assert.equal(nodeTypes.has("routine"), true);
    assert.ok(graph.nodes.some((node) => node.id === `work_item:${workItem.id}`));
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `work_item:${workItem.id}` &&
          link.target === "file:README.md" &&
          link.type === "references"
      )
    );
    assert.ok(
      graph.links.some(
        (link) => link.source === "routine:nightly_repo_digest" && link.type === "triggers"
      )
    );
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === "routine:nightly_repo_digest" &&
          link.target === `artifact:${routineRun.artifactIds[0]}` &&
          link.type === "produced"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("second brain graph connects explicit signal, work item, handoff, artifact, skill, routine, and context relationships", async () => {
  const root = await createGitRepo();
  try {
    const contextId = repositoryId(root);
    const signal = await new IncomingSignalStore(root).create({
      source: "manual",
      title: "Review migration",
      body: "Validate the graph",
      repositoryId: contextId,
    });
    const workItem = await new WorkItemStore(root).create({
      title: "Validate graph",
      repositoryId: contextId,
      contextRefs: [{ kind: "incoming_signal", ref: signal.id }],
    });
    const artifact = await new ArtifactStore(root).createArtifact({
      name: "Migration evidence",
      type: "validation",
      content: "ok",
      contextRefs: [
        { kind: "incoming_signal", ref: signal.id },
        { kind: "work_item", ref: workItem.id },
      ],
    });
    const handoffStore = new HandoffStore(root);
    const draft = await handoffStore.create(
      { id: contextId, name: "graph", path: root },
      { title: "Graph handoff" }
    );
    const finalized = await handoffStore.finalize(draft.id, contextId);
    const graph = await buildSecondBrainGraph(root);

    assert.ok(
      graph.nodes.some(
        (node) => node.id === `repo_context:${contextId}` && node.type === "repo_context"
      )
    );
    assert.ok(graph.nodes.some((node) => node.id === `incoming_signal:${signal.id}`));
    assert.ok(graph.nodes.some((node) => node.id === `handoff:${draft.id}`));
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `incoming_signal:${signal.id}` &&
          link.target === `repo_context:${contextId}` &&
          link.type === "scoped_to"
      )
    );
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `work_item:${workItem.id}` &&
          link.target === `incoming_signal:${signal.id}` &&
          link.type === "references"
      )
    );
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `artifact:${artifact.id}` &&
          link.target === `incoming_signal:${signal.id}` &&
          link.type === "used_context"
      )
    );
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `handoff:${draft.id}` &&
          link.target === `work_item:${workItem.id}` &&
          link.type === "includes"
      )
    );
    assert.ok(
      graph.links.some(
        (link) =>
          link.source === `handoff:${draft.id}` &&
          link.target === `artifact:${finalized.artifactId}` &&
          link.type === "finalized_as"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("second brain graph supports clean first build and isolated multi-repository Local Store reset", async () => {
  const firstRoot = await createGitRepo();
  const secondRoot = await createGitRepo();
  try {
    const firstId = repositoryId(firstRoot);
    const secondId = repositoryId(secondRoot);
    const firstSignal = await new IncomingSignalStore(firstRoot).create({
      source: "manual",
      title: "First repository",
      repositoryId: firstId,
    });
    await new IncomingSignalStore(secondRoot).create({
      source: "manual",
      title: "Second repository",
      repositoryId: secondId,
    });

    const firstBuild = await buildSecondBrainGraph(firstRoot);
    assert.ok(firstBuild.nodes.some((node) => node.id === `incoming_signal:${firstSignal.id}`));

    await resetLocalStore(firstRoot);
    const resetGraph = await buildSecondBrainGraph(firstRoot);
    const secondGraph = await buildSecondBrainGraph(secondRoot);
    assert.equal(
      resetGraph.nodes.some((node) => node.id === `incoming_signal:${firstSignal.id}`),
      false
    );
    assert.ok(
      secondGraph.nodes.some(
        (node) => node.type === "incoming_signal" && node.metadata?.repositoryId === secondId
      )
    );
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});
