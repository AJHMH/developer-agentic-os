import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ArtifactStore } from "../src/server/artifacts/artifact-store";
import { SkillRunStore } from "../src/server/skill-runs/skill-run-store";
import { createSkillRegistry } from "../src/server/skills/skill-registry";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-skills-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await writeFile(join(root, "feature.txt"), "changed\n", "utf8");
  return root;
}

test("skill registry lists built-in and placeholder skill commands", async () => {
  const registry = createSkillRegistry();
  const skills = registry.listSkills();
  assert.deepEqual(
    skills.filter((skill) => skill.kind === "built-in").map((skill) => skill.command),
    [
      "/repo-summary",
      "/branch-summary",
      "/release-readiness",
      "/implementation-checklist",
      "/sprint-digest",
    ]
  );
  assert.ok(
    skills.some((skill) => skill.command === "/newsletter" && skill.kind === "placeholder")
  );
});

test("built-in skill run records lifecycle and creates artifact", async () => {
  const root = await createGitRepo();
  try {
    const registry = createSkillRegistry({
      root,
      artifactStore: new ArtifactStore(root),
      runStore: new SkillRunStore(root),
    });
    const result = await registry.runSkill("repo-summary");

    assert.equal(result.status, "succeeded");
    assert.equal(result.run.skillId, "repo-summary");
    assert.ok(result.run.artifactId);

    const runStore = new SkillRunStore(root);
    const runs = await runStore.listRuns({ limit: 5 });
    assert.equal(runs[0]?.status, "succeeded");

    const artifact = await new ArtifactStore(root).getArtifact(result.run.artifactId ?? "");
    assert.equal(artifact?.type, "repo_summary");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skills with required scope fail cleanly without success artifacts", async () => {
  const root = await createGitRepo();
  try {
    const registry = createSkillRegistry({
      root,
      artifactStore: new ArtifactStore(root),
      runStore: new SkillRunStore(root),
    });
    const result = await registry.runSkill("implementation-checklist");

    assert.equal(result.status, "failed");
    assert.equal(result.run.artifactId, null);
    assert.match(result.run.error ?? "", /work item text/i);
    assert.equal((await new ArtifactStore(root).listArtifacts()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("branch summary requires explicit base and target branch input", async () => {
  const root = await createGitRepo();
  try {
    const registry = createSkillRegistry({
      root,
      artifactStore: new ArtifactStore(root),
      runStore: new SkillRunStore(root),
    });
    const result = await registry.runSkill("branch-summary", { baseBranch: "main" });
    assert.equal(result.status, "failed");
    assert.match(result.run.error ?? "", /target branch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skill runs and artifacts retain repository provenance and stay isolated", async () => {
  const firstRoot = await createGitRepo();
  const secondRoot = await createGitRepo();
  try {
    const firstRegistry = createSkillRegistry({ root: firstRoot });
    const secondRegistry = createSkillRegistry({ root: secondRoot });
    const firstResult = await firstRegistry.runSkill("repo-summary");
    const secondResult = await secondRegistry.runSkill("repo-summary");
    assert.equal(firstResult.run.repositoryRoot, firstRoot);
    assert.equal(secondResult.run.repositoryRoot, secondRoot);
    assert.equal((await new SkillRunStore(firstRoot).listRuns()).length, 1);
    assert.equal((await new SkillRunStore(secondRoot).listRuns()).length, 1);
    assert.equal((await new ArtifactStore(firstRoot).listArtifacts()).length, 1);
    assert.equal((await new ArtifactStore(secondRoot).listArtifacts()).length, 1);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});
