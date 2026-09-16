import assert from "node:assert/strict";
import test from "node:test";

import {
  githubOrgVerificationMessage,
  requiredGitHubOrgForTenant,
  verifyGitHubOrgMembership,
} from "../src/server/hosted-auth/github-link";

test("requiredGitHubOrgForTenant requires an explicit tenant mapping", () => {
  const env = {
    GITHUB_ORG: "fallback-org",
    GITHUB_ORG_MAP: JSON.stringify({
      "org-alpha": "alpha-github-org",
      "org-beta": "beta-github-org",
    }),
  };

  assert.equal(requiredGitHubOrgForTenant("org-alpha", env), "alpha-github-org");
  assert.equal(requiredGitHubOrgForTenant("org-missing", env), null);
  assert.equal(
    requiredGitHubOrgForTenant("org-missing", {
      GITHUB_ORG: "fallback",
      GITHUB_ORG_MAP: "{not-json",
    }),
    null
  );
  assert.equal(requiredGitHubOrgForTenant("org-missing", {}), null);
});

test("githubOrgVerificationMessage returns operator-facing reasons", () => {
  assert.equal(
    githubOrgVerificationMessage("acme", "no_token"),
    "Link your GitHub account to verify access to acme."
  );
  assert.equal(
    githubOrgVerificationMessage("acme", "not_a_member"),
    "You're not a member of the acme GitHub org yet. Ask your admin to add you there."
  );
  assert.equal(
    githubOrgVerificationMessage("acme", "api_error"),
    "We couldn't verify membership for acme on GitHub right now. Please try again."
  );
  assert.equal(githubOrgVerificationMessage("acme", null), null);
});

test("verifyGitHubOrgMembership classifies membership outcomes", async () => {
  const noToken = await verifyGitHubOrgMembership("user-1", "acme", {
    getAccessToken: async () => null,
  });
  assert.deepEqual(noToken, { verified: false, reason: "no_token" });

  const active = await verifyGitHubOrgMembership("user-1", "acme", {
    getAccessToken: async () => "token",
    fetcher: async () => new Response(JSON.stringify({ state: "active" }), { status: 200 }),
  });
  assert.deepEqual(active, { verified: true, reason: null });

  const notMember = await verifyGitHubOrgMembership("user-1", "acme", {
    getAccessToken: async () => "token",
    fetcher: async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
  });
  assert.deepEqual(notMember, { verified: false, reason: "not_a_member" });

  const apiFailure = await verifyGitHubOrgMembership("user-1", "acme", {
    getAccessToken: async () => "token",
    fetcher: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(apiFailure, { verified: false, reason: "api_error" });
});
