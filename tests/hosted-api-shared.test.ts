import assert from "node:assert/strict";
import test from "node:test";

import { hostedError } from "../src/app/api/hosted/_shared";

test("hostedError does not leak unexpected internal error messages", async () => {
  const response = hostedError(new Error("database credentials exploded"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "An unexpected error occurred." });
});
