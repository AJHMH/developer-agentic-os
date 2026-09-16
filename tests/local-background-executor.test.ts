import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createLocalBackgroundExecutor } from "../src/server/routines/local-background-executor";
import { RoutineHistoryStore } from "../src/server/routines/routine-history-store";
import { getLocalStorePaths } from "../src/server/local-store/paths";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-executor-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

function fakeClock(value: string) {
  let current = new Date(value);
  return {
    now: () => new Date(current),
    advance: (days: number) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
}

test("executor runs due background routines once, excludes paused routines, and records source", async () => {
  const root = await createGitRepo();
  try {
    const clock = fakeClock("2026-09-04T08:00:00.000Z");
    const executor = createLocalBackgroundExecutor({ root, clock, leaseTtlMs: 10_000 });
    const first = await executor.trigger();
    assert.equal(first.executed, 3);
    assert.equal((await executor.trigger()).executed, 0);

    const history = await new RoutineHistoryStore(root).listExecutions({ limit: 10 });
    assert.equal(history.length, 3);
    assert.ok(history.every((execution) => execution.source === "local_background"));

    const registry = (
      await import("../src/server/routines/routine-registry")
    ).createRoutineRegistry({ root });
    await registry.pauseRoutine("nightly_repo_digest");
    clock.advance(1);
    assert.equal((await executor.trigger()).executed, 2);
    assert.equal(
      (await new RoutineHistoryStore(root).listExecutions({ routineId: "nightly_repo_digest" }))
        .length,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor recovers an expired lease and reports a live lease as busy", async () => {
  const root = await createGitRepo();
  try {
    const clock = fakeClock("2026-09-04T08:00:00.000Z");
    const paths = getLocalStorePaths(root);
    const executorPath = join(paths.routines, "executor.json");
    await import("../src/server/local-store/paths").then(({ initializeLocalStore }) =>
      initializeLocalStore(root)
    );
    await writeFile(
      executorPath,
      JSON.stringify({
        running: true,
        leaseToken: "held",
        leaseExpiresAt: "2026-09-04T08:00:05.000Z",
        lastTickAt: null,
        lastRunAt: null,
        lastError: null,
      }),
      "utf8"
    );
    const executor = createLocalBackgroundExecutor({ root, clock, leaseTtlMs: 10_000 });
    assert.equal((await executor.trigger()).executed, 0);
    clock.advance(1);
    assert.equal((await executor.trigger()).executed, 3);
    const state = JSON.parse(await readFile(executorPath, "utf8")) as {
      running: boolean;
      leaseToken: string | null;
    };
    assert.equal(state.running, true);
    assert.equal(state.leaseToken, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
