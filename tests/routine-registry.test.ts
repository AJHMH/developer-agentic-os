import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { RoutineHistoryStore } from "../src/server/routines/routine-history-store";
import { createRoutineRegistry } from "../src/server/routines/routine-registry";
import { SkillRunStore } from "../src/server/skill-runs/skill-run-store";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-routines-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await writeFile(join(root, "feature.txt"), "changed\n", "utf8");
  return root;
}

test("routine registry lists real and placeholder routines", async () => {
  const registry = createRoutineRegistry();
  const routines = await registry.listRoutines();
  assert.deepEqual(
    routines.filter((routine) => routine.kind === "built-in").map((routine) => routine.id),
    ["nightly_repo_digest", "weekly_sprint_digest", "release_readiness_scan"]
  );
  assert.ok(
    routines.some(
      (routine) => routine.id === "stale_branch_check" && routine.kind === "placeholder"
    )
  );
  assert.ok(
    routines.every((routine) =>
      ["queued", "next", "running", "succeeded", "failed", "paused", "missed"].includes(
        routine.status
      )
    )
  );
  assert.ok(
    routines
      .filter((routine) => routine.kind === "built-in")
      .every((routine) => routine.executionMode === "local_background")
  );
  assert.ok(
    routines
      .filter((routine) => routine.kind === "placeholder")
      .every((routine) => routine.executionMode === "manual")
  );
});

test("manual routine run records history and links produced artifact", async () => {
  const root = await createGitRepo();
  try {
    const registry = createRoutineRegistry({
      root,
      artifactStore: new ArtifactStore(root),
      skillRunStore: new SkillRunStore(root),
      historyStore: new RoutineHistoryStore(root),
    });
    const result = await registry.runRoutine("weekly_sprint_digest");
    assert.equal(result.status, "succeeded");
    assert.ok(result.artifactIds.length > 0);

    const history = await new RoutineHistoryStore(root).listExecutions({ limit: 5 });
    assert.equal(history[0]?.routineId, "weekly_sprint_digest");
    assert.equal(history[0]?.status, "succeeded");
    assert.equal(history[0]?.source, "manual");
    assert.deepEqual(history[0]?.artifactIds, result.artifactIds);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("routine can be paused and resumed", async () => {
  const root = await createGitRepo();
  try {
    const registry = createRoutineRegistry({ root });
    await registry.pauseRoutine("nightly_repo_digest");
    assert.equal(
      (await registry.listRoutines()).find((routine) => routine.id === "nightly_repo_digest")
        ?.status,
      "paused"
    );
    await registry.resumeRoutine("nightly_repo_digest");
    assert.equal(
      (await registry.listRoutines()).find((routine) => routine.id === "nightly_repo_digest")
        ?.status,
      "next"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("placeholder routine run fails without linked artifacts", async () => {
  const root = await createGitRepo();
  try {
    const registry = createRoutineRegistry({ root, historyStore: new RoutineHistoryStore(root) });
    const result = await registry.runRoutine("artifact_cleanup");
    assert.equal(result.status, "failed");
    assert.deepEqual(result.artifactIds, []);
    assert.match(result.error ?? "", /placeholder routine/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
