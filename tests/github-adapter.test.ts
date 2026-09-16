import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { GitHubAdapter } from "../src/server/integrations/github-adapter";

const execFileAsync = promisify(execFile);

const repositoryEnv = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPOSITORY: "octo/example",
};

test("github adapter maps issues, pull requests, actions, and merge status", async () => {
  const calls: string[] = [];
  const adapter = new GitHubAdapter(repositoryEnv, async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/issues?")) {
      return response([
        {
          number: 12,
          title: "Fix the dashboard",
          state: "open",
          html_url: "https://github.com/octo/example/issues/12",
          updated_at: "2030-01-02T00:00:00Z",
        },
      ]);
    }
    if (url.includes("/pulls?")) {
      return response([
        {
          number: 13,
          title: "Ship operations",
          state: "open",
          draft: false,
          mergeable: true,
          html_url: "https://github.com/octo/example/pull/13",
          updated_at: "2030-01-03T00:00:00Z",
        },
      ]);
    }
    return response({
      workflow_runs: [
        {
          id: 14,
          name: "CI",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/octo/example/actions/runs/14",
          created_at: "2030-01-03T00:00:00Z",
        },
      ],
    });
  });

  const result = await adapter.getOperations();

  assert.equal(result.status, "healthy");
  assert.equal(result.repository, "octo/example");
  assert.equal(result.issues[0]?.number, 12);
  assert.equal(result.pullRequests[0]?.mergeable, "ready");
  assert.equal(result.actions[0]?.conclusion, "success");
  assert.deepEqual(result.mergeStatus, {
    state: "ready",
    message: "All open pull requests are mergeable.",
  });
  assert.equal(calls.length, 3);
});

test("github adapter distinguishes missing configuration and provider failures", async () => {
  const missingRepository = await new GitHubAdapter({ GITHUB_TOKEN: "test-token" }, async () =>
    response({})
  ).getOperations();
  assert.equal(missingRepository.status, "unconfigured");
  assert.match(missingRepository.message, /GITHUB_REPOSITORY/);

  const unauthorized = await new GitHubAdapter(repositoryEnv, async () =>
    response({ message: "Bad credentials" }, 401)
  ).getOperations();
  assert.equal(unauthorized.status, "unhealthy");
  assert.equal(unauthorized.failure?.kind, "authentication");

  const rateLimited = await new GitHubAdapter(repositoryEnv, async () =>
    response({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" })
  ).getOperations();
  assert.equal(rateLimited.status, "unhealthy");
  assert.equal(rateLimited.failure?.kind, "rate_limit");

  const throttled = await new GitHubAdapter(repositoryEnv, async () =>
    response({ message: "Too many requests" }, 429)
  ).getOperations();
  assert.equal(throttled.failure?.kind, "rate_limit");

  const unavailable = await new GitHubAdapter(repositoryEnv, async () => {
    throw new Error("network down");
  }).getOperations();
  assert.equal(unavailable.status, "unhealthy");
  assert.equal(unavailable.failure?.kind, "unavailable");
});

test("github adapter derives the repository from the active context git remote", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-github-"));
  try {
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "https://github.com/context/repository.git"],
      { cwd: root }
    );
    const requested: string[] = [];
    const result = await new GitHubAdapter(
      { GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "wrong/global" },
      async (input) => {
        requested.push(String(input));
        if (String(input).includes("/issues?")) return response([]);
        if (String(input).includes("/pulls?")) return response([]);
        return response({ workflow_runs: [] });
      },
      root
    ).getOperations();

    assert.equal(result.repository, "context/repository");
    assert.ok(requested.every((url) => url.includes("/repos/context/repository/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
