import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { unauthenticatedApiResponse } from "../src/proxy";

test("unauthenticated API requests return a JSON 401 instead of a masked 404", async () => {
  const response = unauthenticatedApiResponse(
    new NextRequest("https://developer-agentic-os-v2.vercel.app/api/skills")
  );

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

test("unauthenticated page requests are left for the Clerk sign-in redirect", () => {
  const response = unauthenticatedApiResponse(
    new NextRequest("https://developer-agentic-os-v2.vercel.app/")
  );

  assert.equal(response, null);
});