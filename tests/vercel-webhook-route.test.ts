import assert from "node:assert/strict";
import test from "node:test";

import { handleVercelWebhookRequest } from "../src/app/api/webhooks/vercel/route";
import type { VercelWebhookRepository } from "../src/server/hosted-deployments/vercel-webhook";

type TestRepository = VercelWebhookRepository & { close: () => Promise<void> };

test("webhook route returns actionable migration-incomplete responses", async () => {
  let closed = false;
  const repository: TestRepository = {
    async findProject() {
      throw new Error("Canonical webhook schema is not installed.");
    },
    async recordEvent() {
      return { duplicate: false };
    },
    async recordAudit() {},
    async close() {
      closed = true;
    },
  };

  const response = await handleVercelWebhookRequest(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: JSON.stringify({ type: "deployment.ready", projectId: "prj_acme" }),
    }),
    repository
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Hosted Tenant migration is incomplete. Run the hosted Neon migrations and retry.",
  });
  assert.equal(closed, true);
});

test("webhook route returns actionable persistence-unavailable responses", async () => {
  const repository: TestRepository = {
    async findProject() {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
    },
    async recordEvent() {
      return { duplicate: false };
    },
    async recordAudit() {},
    async close() {},
  };

  const response = await handleVercelWebhookRequest(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: JSON.stringify({ type: "deployment.ready", projectId: "prj_acme" }),
    }),
    repository
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Hosted persistence is temporarily unavailable. Retry once the hosted database is reachable.",
  });
});
