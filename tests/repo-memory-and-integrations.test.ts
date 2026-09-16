import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { LocalGitAdapter } from "../src/server/git/local-git-adapter";
import { refreshRepoMemorySnapshot } from "../src/server/repo-memory/repo-memory";
import { getIntegrationStatuses } from "../src/server/integrations/integration-registry";

const execFileAsync = promisify(execFile);

async function createGitRepo() {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-git-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  await writeFile(join(root, "feature.txt"), "changed\n", "utf8");
  return root;
}

test("local git adapter reports branch, commits, and changed files", async () => {
  const root = await createGitRepo();
  try {
    const git = new LocalGitAdapter(root);
    const status = await git.getStatus();
    assert.equal(status.available, true);
    assert.equal(status.currentBranch, "main");
    assert.ok(status.recentCommits.length >= 1);
    assert.ok(status.changedFiles.includes("feature.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo memory snapshot is refreshable and persisted", async () => {
  const root = await createGitRepo();
  try {
    const snapshot = await refreshRepoMemorySnapshot(root);
    assert.equal(snapshot.repoName, root.split(/[\\/]/).at(-1));
    assert.ok(snapshot.files.some((file) => file.path === "README.md"));
    assert.ok(snapshot.git.available);

    const stored = JSON.parse(
      await readFile(join(root, ".developer-agentic-os", "repo-memory", "snapshot.json"), "utf8")
    );
    assert.equal(stored.repoName, snapshot.repoName);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-git folders return a clear unavailable git state", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-no-git-"));
  try {
    await writeFile(join(root, "README.md"), "hello\n", "utf8");
    const snapshot = await refreshRepoMemorySnapshot(root);
    assert.equal(snapshot.git.available, false);
    assert.equal(snapshot.git.currentBranch, null);
    assert.match(snapshot.git.message, /not a git checkout/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("integration registry reports the operations provider catalog and credential states", async () => {
  const root = await createGitRepo();
  try {
    const withoutToken = await getIntegrationStatuses(root, {});
    const localGit = withoutToken.find((integration) => integration.id === "local-git");
    const github = withoutToken.find((integration) => integration.id === "github");
    const vercel = withoutToken.find((integration) => integration.id === "vercel");
    const providerIds = withoutToken.map((integration) => integration.id);

    assert.deepEqual(providerIds, [
      "local-git",
      "github",
      "vercel",
      "sentry",
      "cloudflare",
      "coderabbit",
      "workos",
      "clerk",
      "convex",
      "neondb",
      "upstash",
      "email",
      "slack",
    ]);
    assert.equal(localGit?.required, true);
    assert.equal(localGit?.status, "connected");
    assert.equal(github?.status, "unconfigured");
    assert.equal(vercel?.status, "unconfigured");
    assert.equal(
      withoutToken.find((integration) => integration.id === "sentry")?.status,
      "unconfigured"
    );
    assert.equal(
      withoutToken.find((integration) => integration.id === "email")?.status,
      "available"
    );

    const withToken = await getIntegrationStatuses(root, {
      GITHUB_TOKEN: "redacted-test-token",
      VERCEL_TOKEN: "redacted-vercel-token",
      VERCEL_PROJECT_ID: "prj_test",
    });
    assert.equal(withToken.find((integration) => integration.id === "github")?.status, "connected");
    assert.equal(withToken.find((integration) => integration.id === "vercel")?.status, "connected");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
