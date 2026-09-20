import assert from "node:assert/strict";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import {
  DEFAULT_API_VERSION,
  HEADER_API_VERSION,
  HEADER_CORRELATION_ID,
  HEADER_IDEMPOTENT_REPLAYED,
  SUPPORTED_API_VERSIONS,
  type HostedErrorEnvelope,
} from "../src/server/hosted-api/contract";
import { HostedIdempotencyStore } from "../src/server/hosted-api/idempotency";
import {
  GET as getWorkspaces,
  POST as postWorkspace,
} from "../src/app/api/hosted/workspaces/route";
import { GET as getAudit } from "../src/app/api/hosted/audit/route";

function makeAuthHeaders(userId: string, tenantId = `tenant-${userId}`) {
  return {
    "x-hosted-user-id": userId,
    "x-hosted-tenant-id": tenantId,
    "x-hosted-user-name": `User ${userId}`,
    "x-hosted-org-role": "org:admin",
  };
}

async function parseJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test("Hosted Operational API Contract: Route-Seam Verification", async (t) => {
  HostedIdempotencyStore.getInstance().clear();

  await t.test(
    "1. API Versioning: declares supported version and rejects unsupported versions",
    async () => {
      const userId = `ver-user-${Date.now()}`;
      const headers = makeAuthHeaders(userId);

      // Request without version header defaults to DEFAULT_API_VERSION (2026-09-01)
      const unversionedReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers,
      });
      const unversionedRes = await getWorkspaces(unversionedReq);
      assert.equal(unversionedRes.status, 200);
      assert.equal(unversionedRes.headers.get(HEADER_API_VERSION), DEFAULT_API_VERSION);
      assert.ok(unversionedRes.headers.get(HEADER_CORRELATION_ID));

      // Request with canonical supported version returns 200 and version header
      const versionedReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: {
          ...headers,
          [HEADER_API_VERSION]: "2026-09-01",
        },
      });
      const versionedRes = await getWorkspaces(versionedReq);
      assert.equal(versionedRes.status, 200);
      assert.equal(versionedRes.headers.get(HEADER_API_VERSION), "2026-09-01");

      // Request with alias version (v1) returns 200 and version header
      const aliasReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: {
          ...headers,
          [HEADER_API_VERSION]: "v1",
        },
      });
      const aliasRes = await getWorkspaces(aliasReq);
      assert.equal(aliasRes.status, 200);
      assert.equal(aliasRes.headers.get(HEADER_API_VERSION), "v1");

      // Request with unsupported version is rejected predictably with 400
      const unsupportedReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: {
          ...headers,
          [HEADER_API_VERSION]: "1999-01-01",
        },
      });
      const unsupportedRes = await getWorkspaces(unsupportedReq);
      assert.equal(unsupportedRes.status, 400);
      assert.equal(unsupportedRes.headers.get(HEADER_API_VERSION), DEFAULT_API_VERSION);
      assert.ok(unsupportedRes.headers.get(HEADER_CORRELATION_ID));

      const errBody = await parseJson<HostedErrorEnvelope>(unsupportedRes);
      assert.equal(errBody.code, "UNSUPPORTED_API_VERSION");
      assert.equal(errBody.error.code, "UNSUPPORTED_API_VERSION");
      assert.equal(errBody.retryable, false);
      assert.match(errBody.message, /Unsupported API version '1999-01-01'/);
      assert.ok(SUPPORTED_API_VERSIONS.includes("2026-09-01"));
    }
  );

  await t.test(
    "2. Correlation ID: every request has a correlation ID returned and recorded in audit evidence",
    async () => {
      const userId = `corr-user-${Date.now()}`;
      const customCorrelationId = `runbook-trace-${Date.now()}-abc`;
      const headers = {
        ...makeAuthHeaders(userId),
        [HEADER_CORRELATION_ID]: customCorrelationId,
      };

      // Mutation passing custom correlation ID
      const createReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Workspace with Correlation" }),
      });
      const createRes = await postWorkspace(createReq);
      assert.equal(createRes.status, 201);
      assert.equal(createRes.headers.get(HEADER_CORRELATION_ID), customCorrelationId);
      assert.equal(createRes.headers.get(HEADER_API_VERSION), DEFAULT_API_VERSION);

      // Read audit log to verify the correlationId was recorded on the audit event
      const auditReq = new Request("http://localhost/api/hosted/audit", {
        method: "GET",
        headers,
      });
      const auditRes = await getAudit(auditReq);
      assert.equal(auditRes.status, 200);
      assert.equal(auditRes.headers.get(HEADER_CORRELATION_ID), customCorrelationId);

      const auditData = await parseJson<{
        events: Array<{ action: string; correlationId?: string }>;
      }>(auditRes);
      const createdEvent = auditData.events.find((e) => e.action === "workspace.created");
      assert.ok(createdEvent, "workspace.created event should exist");
      assert.equal(createdEvent.correlationId, customCorrelationId);

      // Request without correlation ID generates a UUID automatically
      const autoReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: makeAuthHeaders(`auto-${Date.now()}`),
      });
      const autoRes = await getWorkspaces(autoReq);
      const generatedId = autoRes.headers.get(HEADER_CORRELATION_ID);
      assert.ok(generatedId);
      assert.match(generatedId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  );

  await t.test(
    "3. Idempotency: retried mutations produce one logical effect and a stable response",
    async () => {
      const userId = `idem-user-${Date.now()}`;
      const idempotencyKey = `idem-key-ws-${Date.now()}`;
      const headers = {
        ...makeAuthHeaders(userId),
        "idempotency-key": idempotencyKey,
      };
      const body = JSON.stringify({ name: "Idempotent Workspace" });

      // First mutation request
      const firstReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers,
        body,
      });
      const firstRes = await postWorkspace(firstReq);
      assert.equal(firstRes.status, 201);
      assert.equal(firstRes.headers.get(HEADER_IDEMPOTENT_REPLAYED), null);
      const firstData = await parseJson<{ workspace: { id: string; name: string } }>(firstRes);
      const createdWorkspaceId = firstData.workspace.id;
      assert.equal(firstData.workspace.name, "Idempotent Workspace");

      // Identical retry with same key and same body
      const retryReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers,
        body,
      });
      const retryRes = await postWorkspace(retryReq);
      assert.equal(retryRes.status, 201);
      assert.equal(retryRes.headers.get(HEADER_IDEMPOTENT_REPLAYED), "true");
      const retryData = await parseJson<{ workspace: { id: string; name: string } }>(retryRes);
      assert.equal(retryData.workspace.id, createdWorkspaceId);
      assert.equal(retryData.workspace.name, "Idempotent Workspace");

      // Verify one logical effect in domain state: only ONE workspace exists
      const listReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: makeAuthHeaders(userId),
      });
      const listRes = await getWorkspaces(listReq);
      const listData = await parseJson<{ workspaces: Array<{ id: string; name: string }> }>(
        listRes
      );
      const matching = listData.workspaces.filter((w) => w.id === createdWorkspaceId);
      assert.equal(matching.length, 1);

      // Verify audit log has only one workspace.created event
      const auditReq = new Request("http://localhost/api/hosted/audit", {
        method: "GET",
        headers: makeAuthHeaders(userId),
      });
      const auditRes = await getAudit(auditReq);
      const auditData = await parseJson<{
        events: Array<{ action: string; workspaceId?: string }>;
      }>(auditRes);
      const createdEvents = auditData.events.filter(
        (e) => e.action === "workspace.created" && e.workspaceId === createdWorkspaceId
      );
      assert.equal(
        createdEvents.length,
        1,
        "Must produce only one logical effect in audit evidence"
      );

      // Retry with SAME key but DIFFERENT body must be rejected with 409 IDEMPOTENCY_KEY_MISMATCH
      const tamperedReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Tampered Workspace Name" }),
      });
      const tamperedRes = await postWorkspace(tamperedReq);
      assert.equal(tamperedRes.status, 409);
      const tamperedBody = await parseJson<HostedErrorEnvelope>(tamperedRes);
      assert.equal(tamperedBody.code, "IDEMPOTENCY_KEY_MISMATCH");
      assert.equal(tamperedBody.retryable, false);
      assert.match(tamperedBody.message, /payload mismatch/i);
    }
  );

  await t.test("4. Error Envelopes: machine-readable taxonomy across failures", async () => {
    // 4.1 Authentication failure (401 UNAUTHENTICATED) on versioned request
    const unauthReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "GET",
      headers: {
        [HEADER_API_VERSION]: "2026-09-01",
      },
    });
    const unauthRes = await getWorkspaces(unauthReq);
    assert.equal(unauthRes.status, 401);
    assert.ok(unauthRes.headers.get(HEADER_CORRELATION_ID));
    assert.equal(unauthRes.headers.get(HEADER_API_VERSION), DEFAULT_API_VERSION);
    const unauthBody = await parseJson<HostedErrorEnvelope>(unauthRes);
    assert.equal(unauthBody.code, "UNAUTHENTICATED");
    assert.equal(unauthBody.error.code, "UNAUTHENTICATED");
    assert.equal(unauthBody.retryable, false);

    // 4.1b Unversioned request returns legacy { error: string } body while preserving response headers
    const legacyUnauthReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "GET",
    });
    const legacyUnauthRes = await getWorkspaces(legacyUnauthReq);
    assert.equal(legacyUnauthRes.status, 401);
    assert.deepEqual(await parseJson(legacyUnauthRes), { error: "Authentication is required." });
    assert.equal(legacyUnauthRes.headers.get(HEADER_API_VERSION), DEFAULT_API_VERSION);
    assert.ok(legacyUnauthRes.headers.get(HEADER_CORRELATION_ID));

    // 4.2 Validation failure: missing workspace name (400 VALIDATION_ERROR)
    const validUser = `err-user-${Date.now()}`;
    const invalidNameReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: {
        ...makeAuthHeaders(validUser),
        [HEADER_API_VERSION]: "2026-09-01",
      },
      body: JSON.stringify({ name: "   " }),
    });
    const invalidNameRes = await postWorkspace(invalidNameReq);
    assert.equal(invalidNameRes.status, 400);
    const invalidNameBody = await parseJson<HostedErrorEnvelope>(invalidNameRes);
    assert.equal(invalidNameBody.code, "VALIDATION_ERROR");
    assert.equal(invalidNameBody.error.code, "VALIDATION_ERROR");
    assert.equal(invalidNameBody.retryable, false);

    // 4.3 Validation failure: malformed JSON (400 VALIDATION_ERROR)
    const malformedReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: {
        ...makeAuthHeaders(validUser),
        [HEADER_API_VERSION]: "2026-09-01",
      },
      body: "{ not-json",
    });
    const malformedRes = await postWorkspace(malformedReq);
    assert.equal(malformedRes.status, 400);
    const malformedBody = await parseJson<HostedErrorEnvelope>(malformedRes);
    assert.equal(malformedBody.code, "VALIDATION_ERROR");
    assert.match(malformedBody.message, /valid JSON/i);

    // 4.4 Validation failure: missing workspace name property (400 VALIDATION_ERROR)
    const missingNameReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: {
        ...makeAuthHeaders(validUser),
        [HEADER_API_VERSION]: "2026-09-01",
      },
      body: JSON.stringify({}),
    });
    const missingNameRes = await postWorkspace(missingNameReq);
    assert.equal(missingNameRes.status, 400);
    const missingNameBody = await parseJson<HostedErrorEnvelope>(missingNameRes);
    assert.equal(missingNameBody.code, "VALIDATION_ERROR");
    assert.match(missingNameBody.message, /Workspace name is required/i);

    // 4.5 Validation failure: non-string workspace name (400 VALIDATION_ERROR)
    const invalidTypeReq = new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers: {
        ...makeAuthHeaders(validUser),
        [HEADER_API_VERSION]: "2026-09-01",
      },
      body: JSON.stringify({ name: 12345 }),
    });
    const invalidTypeRes = await postWorkspace(invalidTypeReq);
    assert.equal(invalidTypeRes.status, 400);
    const invalidTypeBody = await parseJson<HostedErrorEnvelope>(invalidTypeRes);
    assert.equal(invalidTypeBody.code, "VALIDATION_ERROR");
    assert.match(invalidTypeBody.message, /Workspace name is required/i);
  });

  await t.test(
    "5. Proving Vertical Slice: workspace lifecycle with version negotiation, correlation ID, and idempotency replay",
    async () => {
      const userId = `slice-user-${Date.now()}`;
      const correlationId = `corr-slice-${Date.now()}`;
      const idempotencyKey = `idem-slice-${Date.now()}`;
      const headers = {
        ...makeAuthHeaders(userId),
        [HEADER_API_VERSION]: "2026-09-01",
        [HEADER_CORRELATION_ID]: correlationId,
        "idempotency-key": idempotencyKey,
      };

      // 1. Initial creation with version, correlation ID, and idempotency key
      const createReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Proving Slice Workspace" }),
      });
      const createRes = await postWorkspace(createReq);
      assert.equal(createRes.status, 201);
      assert.equal(createRes.headers.get(HEADER_API_VERSION), "2026-09-01");
      assert.equal(createRes.headers.get(HEADER_CORRELATION_ID), correlationId);
      assert.equal(createRes.headers.get(HEADER_IDEMPOTENT_REPLAYED), null);
      const createdData = await parseJson<{ workspace: { id: string; name: string } }>(createRes);
      assert.equal(createdData.workspace.name, "Proving Slice Workspace");
      const workspaceId = createdData.workspace.id;

      // 2. Safe replay with same idempotency key and payload
      const replayReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "POST",
        headers: {
          ...headers,
          [HEADER_CORRELATION_ID]: `corr-replay-${Date.now()}`,
        },
        body: JSON.stringify({ name: "Proving Slice Workspace" }),
      });
      const replayRes = await postWorkspace(replayReq);
      assert.equal(replayRes.status, 201);
      assert.equal(replayRes.headers.get(HEADER_IDEMPOTENT_REPLAYED), "true");
      const replayedData = await parseJson<{ workspace: { id: string; name: string } }>(replayRes);
      assert.equal(replayedData.workspace.id, workspaceId);

      // 3. Read back via GET /api/hosted/workspaces
      const listReq = new Request("http://localhost/api/hosted/workspaces", {
        method: "GET",
        headers: {
          ...makeAuthHeaders(userId),
          [HEADER_API_VERSION]: "2026-09-01",
        },
      });
      const listRes = await getWorkspaces(listReq);
      assert.equal(listRes.status, 200);
      assert.equal(listRes.headers.get(HEADER_API_VERSION), "2026-09-01");
      const listData = await parseJson<{ workspaces: Array<{ id: string; name: string }> }>(
        listRes
      );
      const found = listData.workspaces.find((w) => w.id === workspaceId);
      assert.ok(found, "Created workspace must be listed");

      // 4. Audit verification: check that workspace.created was recorded with the original correlation ID
      const auditReq = new Request("http://localhost/api/hosted/audit", {
        method: "GET",
        headers: {
          ...makeAuthHeaders(userId),
          [HEADER_API_VERSION]: "2026-09-01",
        },
      });
      const auditRes = await getAudit(auditReq);
      assert.equal(auditRes.status, 200);
      const auditData = await parseJson<{
        events: Array<{ action: string; workspaceId?: string; correlationId?: string }>;
      }>(auditRes);
      const auditEvent = auditData.events.find(
        (e) => e.action === "workspace.created" && e.workspaceId === workspaceId
      );
      assert.ok(auditEvent, "workspace.created audit event must exist");
      assert.equal(
        auditEvent.correlationId,
        correlationId,
        "Audit event must record the request correlation ID"
      );
    }
  );
});
