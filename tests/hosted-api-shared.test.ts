import assert from "node:assert/strict";
import test from "node:test";

import { hostedError } from "../src/app/api/hosted/_shared";

test("hostedError does not leak unexpected internal error messages", async () => {
  const response = hostedError(new Error("database credentials exploded"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "An unexpected error occurred." });
});

test("hostedError returns actionable cutover and persistence responses", async () => {
  const migrationIncomplete = hostedError(new Error("Canonical hosted state schema is not installed."));
  assert.equal(migrationIncomplete.status, 409);
  assert.deepEqual(await migrationIncomplete.json(), {
    error: "Hosted Tenant migration is incomplete. Run the hosted Neon migrations and retry.",
  });

  const unconfigured = hostedError(
    new Error(
      "Hosted persistence requires DATABASE_URL, DATABASE_URL_UNPOOLED, DEV_AGENTIC_OS_DATABASE_URL, or DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED."
    )
  );
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), {
    error: "Hosted persistence is not configured. Set the hosted database URL and retry.",
  });

  const unavailable = hostedError(
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error:
      "Hosted persistence is temporarily unavailable. Retry once the hosted database is reachable.",
  });
});
