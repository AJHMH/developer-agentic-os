import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getFocusBoard } from "../src/server/focus-board/focus-board";
import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { RoutineHistoryStore } from "../src/server/routines/routine-history-store";
import { SkillRunStore } from "../src/server/skill-runs/skill-run-store";
import { WorkItemStore } from "../src/server/work-items/work-item-store";
import { createSkillRegistry } from "../src/server/skills/skill-registry";
import { OperationalStore } from "../src/server/operational/operational-store";

test("focus board aggregates one repository without duplicating or leaking records", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-focus-board-"));
  try {
    const repositoryId = "repo-a";
    const otherRepositoryId = "repo-b";
    const workItems = new WorkItemStore(root);
    const artifactStore = new ArtifactStore(root);
    const skillRuns = new SkillRunStore(root);
    const routineHistory = new RoutineHistoryStore(root);
    const now = new Date("2026-09-05T12:00:00.000Z");
    const overdue = await workItems.create({
      title: "Overdue",
      repositoryId,
      dueAt: "2026-09-04T12:00:00.000Z",
      priority: "high",
    });
    const blocked = await workItems.create({ title: "Blocked", repositoryId, status: "blocked" });
    await workItems.create({
      title: "Other repository",
      repositoryId: otherRepositoryId,
      dueAt: "2026-09-01T12:00:00.000Z",
    });
    const artifact = await artifactStore.createArtifact({
      name: "Today digest",
      type: "digest",
      content: "current",
    });
    const skill = createSkillRegistry({ root, artifactStore, runStore: skillRuns }).listSkills()[0];
    const failedSkill = await skillRuns.createRun(skill, {});
    await skillRuns.updateRun({
      ...failedSkill,
      status: "failed",
      error: "test failure",
      completedAt: now.toISOString(),
    });
    const execution = await routineHistory.createExecution("stale_branch_check", {
      startedAt: now.toISOString(),
    });
    await routineHistory.completeExecution(execution, {
      status: "failed",
      error: "routine failure",
      completedAt: now.toISOString(),
    });
    const operational = new OperationalStore(root);
    const queued = await operational.createRun({
      repositoryId,
      policyId: "policy",
      trigger: "provider",
      input: {},
      status: "queued",
      steps: [],
      outputs: [],
      error: null,
    });
    const running = await operational.createRun({
      repositoryId,
      policyId: "policy",
      trigger: "provider",
      input: {},
      status: "running",
      steps: [],
      outputs: [],
      error: null,
    });

    const board = await getFocusBoard(repositoryId, root, { now: () => now, workItems });

    assert.deepEqual(
      board.workItems.map((item) => item.id),
      [blocked.id, overdue.id]
    );
    assert.deepEqual(
      board.overdueWorkItems.map((item) => item.id),
      [overdue.id]
    );
    assert.deepEqual(
      board.blockedWorkItems.map((item) => item.id),
      [blocked.id]
    );
    assert.deepEqual(
      board.recentArtifacts.map((item) => item.id),
      [artifact.id]
    );
    assert.deepEqual(
      board.failedSkillRuns.map((run) => run.id),
      [failedSkill.id]
    );
    assert.equal(board.failedRoutineExecutions[0]?.routineName, "Stale Branch Check");
    assert.deepEqual(
      board.operationalRuns.map((run) => run.id),
      [running.id, queued.id]
    );
    assert.equal(JSON.stringify(board).includes("Other repository"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
