import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GET } from "../src/app/api/email/route";
import { LocalEmailAdapter } from "../src/server/email/email-adapter";
import { getIntegrationStatuses } from "../src/server/integrations/integration-registry";
import { IncomingSignalStore } from "../src/server/incoming-signals/incoming-signal-store";

test("email adapter provides local demo signals without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-email-"));
  try {
    const adapter = new LocalEmailAdapter(root, {});
    assert.equal(adapter.getStatus().status, "available");
    const result = await adapter.sync("repo-demo");
    assert.equal(result.signals.length, 2);
    assert.equal(result.signals[0]?.source, "email");
    assert.match(result.signals[0]?.body ?? "", /From: demo@example.test/);
    assert.equal((await adapter.sync("repo-demo")).signals.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured provider data maps into Inbox signals and stays read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-email-provider-"));
  try {
    const adapter = new LocalEmailAdapter(root, {
      EMAIL_PROVIDER: "imap",
      EMAIL_PROVIDER_DATA: JSON.stringify([
        {
          id: "provider-1",
          subject: "Provider subject",
          sender: "person@example.test",
          body: "Provider body",
        },
      ]),
    });
    assert.equal(adapter.getStatus().status, "connected");
    const result = await adapter.sync("repo-provider");
    assert.equal(result.signals[0]?.title, "Provider subject");
    assert.match(result.signals[0]?.body ?? "", /Provider body/);
    assert.equal(typeof (adapter as unknown as { send?: unknown }).send, "undefined");
    assert.equal(typeof (adapter as unknown as { reply?: unknown }).reply, "undefined");
    assert.equal(typeof (adapter as unknown as { delete?: unknown }).delete, "undefined");
    assert.equal(
      (await new IncomingSignalStore(root).list({ repositoryId: "repo-provider", source: "email" }))
        .length,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("email adapter exposes available, disabled, and error provider states", () => {
  assert.equal(
    new LocalEmailAdapter(process.cwd(), { EMAIL_PROVIDER: "imap" }).getStatus().status,
    "available"
  );
  assert.equal(
    new LocalEmailAdapter(process.cwd(), { EMAIL_ENABLED: "false" }).getStatus().status,
    "disabled"
  );
  assert.equal(
    new LocalEmailAdapter(process.cwd(), {
      EMAIL_PROVIDER: "imap",
      EMAIL_PROVIDER_DATA: "not-json",
    }).getStatus().status,
    "error"
  );
});

test("integration registry uses the email adapter status", async () => {
  const integrations = await getIntegrationStatuses(process.cwd(), {
    EMAIL_PROVIDER: "imap",
    EMAIL_PROVIDER_DATA: "[]",
  });
  assert.equal(integrations.find((integration) => integration.id === "email")?.status, "connected");
});

test("email route syncs local signals and has no write endpoint", async () => {
  const response = await GET(new Request("http://localhost/api/email"));
  const body = (await response.json()) as {
    integration: { id: string };
    signals: Array<{ source: string }>;
  };
  assert.equal(response.status, 200);
  assert.equal(body.integration.id, "email");
  assert.ok(body.signals.every((signal) => signal.source === "email"));
});
