import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { VercelAdapter } from "../src/server/integrations/vercel-adapter";

const projectEnv = { VERCEL_TOKEN: "test-token", VERCEL_PROJECT_ID: "prj_example" };

test("vercel adapter maps deployments and log links", async () => {
  const calls: string[] = [];
  const adapter = new VercelAdapter(projectEnv, async (input) => {
    calls.push(String(input));
    return response({
      deployments: [
        {
          uid: "dpl_1",
          name: "example",
          url: "example-abc.vercel.app",
          state: "READY",
          created: 1893456000000,
          target: "production",
          meta: { githubCommitSha: "abc123" },
        },
      ],
    });
  });

  const result = await adapter.getOperations();

  assert.equal(result.status, "healthy");
  assert.equal(result.projectId, "prj_example");
  assert.equal(result.deployments[0]?.state, "ready");
  assert.equal(result.deployments[0]?.target, "production");
  assert.match(result.deployments[0]?.buildLogUrl ?? "", /vercel\.com\/deployments\/dpl_1/);
  assert.match(result.deployments[0]?.runtimeLogUrl ?? "", /vercel\.com\/.*\/logs/);
  assert.equal(calls.length, 1);
});

test("vercel adapter distinguishes configuration and provider failures", async () => {
  const missingProject = await new VercelAdapter({ VERCEL_TOKEN: "test-token" }, async () =>
    response({})
  ).getOperations();
  assert.equal(missingProject.status, "unconfigured");
  assert.match(missingProject.message, /VERCEL_PROJECT_ID/);

  const unauthorized = await new VercelAdapter(projectEnv, async () =>
    response({}, 401)
  ).getOperations();
  assert.equal(unauthorized.status, "unhealthy");
  assert.equal(unauthorized.failure?.kind, "authentication");

  const rateLimited = await new VercelAdapter(projectEnv, async () =>
    response({}, 429)
  ).getOperations();
  assert.equal(rateLimited.failure?.kind, "rate_limit");

  const timedOut = await new VercelAdapter(projectEnv, async () => {
    throw new Error("request timeout");
  }).getOperations();
  assert.equal(timedOut.failure?.kind, "timeout");
});

test("vercel adapter uses the active context project and reports failed deployments", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-vercel-"));
  try {
    await mkdir(join(root, ".vercel"), { recursive: true });
    await writeFile(
      join(root, ".vercel", "project.json"),
      JSON.stringify({ projectId: "prj_context", orgId: "team_context" }),
      "utf8"
    );
    const result = await new VercelAdapter(
      { VERCEL_TOKEN: "test-token", VERCEL_PROJECT_ID: "wrong/global" },
      async () =>
        response({
          deployments: [
            { uid: "dpl_error", name: "broken", state: "ERROR", created: 1893456000000 },
          ],
        }),
      root
    ).getOperations();
    assert.equal(result.projectId, "prj_context");
    assert.equal(result.status, "unhealthy");
    assert.equal(result.failure?.kind, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
