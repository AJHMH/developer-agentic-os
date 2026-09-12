import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  handleVercelWebhook,
  type VercelWebhookRepository,
} from "../src/server/hosted-deployments/vercel-webhook";

test("valid deployment webhooks persist a tenant-scoped event", async () => {
  const events: Array<Record<string, unknown>> = [];
  const projections: Array<Record<string, unknown>> = [];
  const repository: VercelWebhookRepository = {
    async findProject(projectId) {
      return projectId === "prj_acme"
        ? { tenantId: "tenant-acme", projectId, secret: "webhook-secret" }
        : null;
    },
    async recordEvent(event) {
      events.push(event);
      return { duplicate: false };
    },
    async updateProjection(event) {
      projections.push(event);
    },
    async recordAudit() {},
  };
  const payload = JSON.stringify({
    type: "deployment.ready",
    projectId: "prj_acme",
    deploymentId: "dpl_123",
    deployment: { state: "READY", url: "acme.example.com" },
    meta: { githubCommitSha: "abc123" },
    createdAt: "2026-09-12T12:00:00.000Z",
  });
  const signature = createHmac("sha256", "webhook-secret").update(payload).digest("hex");

  const response = await handleVercelWebhook(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: payload,
      headers: { "x-vercel-signature": signature },
    }),
    repository
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, duplicate: false });
  assert.deepEqual(events, [
    {
      tenantId: "tenant-acme",
      projectId: "prj_acme",
      deploymentId: "dpl_123",
      eventType: "deployment.ready",
      status: "READY",
      url: "https://acme.example.com",
      commitSha: "abc123",
      payload: JSON.parse(payload),
      occurredAt: "2026-09-12T12:00:00.000Z",
    },
  ]);
  assert.equal(projections.length, 1);
  assert.equal(projections[0]?.deploymentId, "dpl_123");
});

test("invalid signatures are rejected without persisting an event", async () => {
  const audits: Array<Record<string, unknown>> = [];
  let eventCount = 0;
  const repository: VercelWebhookRepository = {
    async findProject() {
      return { tenantId: "tenant-acme", projectId: "prj_acme", secret: "webhook-secret" };
    },
    async recordEvent() {
      eventCount += 1;
      return { duplicate: false };
    },
    async recordAudit(entry) {
      audits.push(entry);
    },
  };

  const response = await handleVercelWebhook(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: JSON.stringify({ type: "deployment.ready", projectId: "prj_acme", deploymentId: "dpl_1" }),
      headers: { "x-vercel-signature": "invalid" },
    }),
    repository
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, duplicate: false });
  assert.equal(eventCount, 0);
  assert.deepEqual(audits, [{ action: "invalid_signature", projectId: "prj_acme" }]);
});

test("unknown projects are acknowledged without revealing tenant registration", async () => {
  const audits: Array<Record<string, unknown>> = [];
  const repository: VercelWebhookRepository = {
    async findProject() {
      return null;
    },
    async recordEvent() {
      throw new Error("unknown projects must not be persisted");
    },
    async recordAudit(entry) {
      audits.push(entry);
    },
  };

  const response = await handleVercelWebhook(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: JSON.stringify({ type: "deployment.ready", projectId: "prj_unknown", deploymentId: "dpl_1" }),
    }),
    repository
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, duplicate: false });
  assert.deepEqual(audits, [{ action: "unknown_project", projectId: "prj_unknown" }]);
});

test("duplicate deployment errors do not repeat projection or failure signals", async () => {
  let projectionCount = 0;
  let signalCount = 0;
  const audits: Array<Record<string, unknown>> = [];
  const repository: VercelWebhookRepository = {
    async findProject() {
      return { tenantId: "tenant-acme", projectId: "prj_acme", secret: "webhook-secret" };
    },
    async recordEvent() {
      return { duplicate: true };
    },
    async updateProjection() {
      projectionCount += 1;
    },
    async recordFailureSignal() {
      signalCount += 1;
    },
    async recordAudit(entry) {
      audits.push(entry);
    },
  };
  const payload = JSON.stringify({
    type: "deployment.error",
    projectId: "prj_acme",
    deploymentId: "dpl_failed",
    deployment: { state: "ERROR" },
  });
  const signature = createHmac("sha256", "webhook-secret").update(payload).digest("hex");

  const response = await handleVercelWebhook(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: payload,
      headers: { "x-vercel-signature": signature },
    }),
    repository
  );

  assert.equal(response.status, 202);
  assert.equal(projectionCount, 0);
  assert.equal(signalCount, 0);
  assert.deepEqual(audits, [{ action: "duplicate", projectId: "prj_acme" }]);
});

test("the previous secret remains valid during rotation", async () => {
  let persisted = 0;
  const repository: VercelWebhookRepository = {
    async findProject() {
      return {
        tenantId: "tenant-acme",
        projectId: "prj_acme",
        secret: "new-secret",
        previousSecret: "old-secret",
      };
    },
    async recordEvent() {
      persisted += 1;
      return { duplicate: false };
    },
    async recordAudit() {},
  };
  const payload = JSON.stringify({
    type: "deployment.ready",
    projectId: "prj_acme",
    deploymentId: "dpl_rotated",
  });
  const signature = createHmac("sha256", "old-secret").update(payload).digest("hex");

  const response = await handleVercelWebhook(
    new Request("http://localhost/api/webhooks/vercel", {
      method: "POST",
      body: payload,
      headers: { "x-vercel-signature": signature },
    }),
    repository
  );

  assert.equal(response.status, 202);
  assert.equal(persisted, 1);
});