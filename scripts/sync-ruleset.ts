#!/usr/bin/env node

/**
 * Script to synchronize and verify GitHub repository rulesets
 * using .github/rulesets/main-ruleset.json as the declarative source of truth.
 *
 * Usage:
 *   npx tsx scripts/sync-ruleset.ts
 *
 * Requirements:
 *   - GITHUB_TOKEN or GH_TOKEN environment variable (or authenticated `gh` CLI)
 *   - GITHUB_REPOSITORY (e.g. "owner/repo") or inferred from git remote
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface RulesetSummary {
  id: number;
  name: string;
  target: string;
  enforcement: string;
}

function getRepoSlug(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // Ignore and fallback
  }
  throw new Error(
    "Unable to determine repository slug. Set GITHUB_REPOSITORY environment variable."
  );
}

function getAuthToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "No GitHub auth token available. Set GITHUB_TOKEN / GH_TOKEN or log in with `gh auth login`."
    );
  }
}

async function githubRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "developer-agentic-os-ruleset-sync",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json() as Promise<T>;
}

async function main() {
  const repo = getRepoSlug();
  const rulesetPath = join(process.cwd(), ".github", "rulesets", "main-ruleset.json");
  const rulesetContent = await readFile(rulesetPath, "utf8");
  const rulesetConfig = JSON.parse(rulesetContent);

  console.log(`Synchronizing branch ruleset for repository: ${repo}...`);

  // 1. List existing repository rulesets
  const existingRulesets = await githubRequest<RulesetSummary[]>(`/repos/${repo}/rulesets`);
  const targetRuleset = existingRulesets.find(
    (r) =>
      r.name === rulesetConfig.name ||
      r.name === "Branch Protection Rules" ||
      r.name.toLowerCase().includes("branch protection")
  );

  let result;
  if (targetRuleset) {
    console.log(`Found existing ruleset ID ${targetRuleset.id}. Updating...`);
    result = await githubRequest<RulesetSummary>(`/repos/${repo}/rulesets/${targetRuleset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rulesetConfig),
    });
  } else {
    console.log("No matching ruleset found. Creating new repository ruleset...");
    result = await githubRequest<RulesetSummary>(`/repos/${repo}/rulesets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rulesetConfig),
    });
  }

  console.log(`✅ Ruleset "${result.name}" (ID: ${result.id}) is now active on ${repo}.`);
}

main().catch((err) => {
  console.error("❌ Failed to synchronize ruleset:", err.message);
  process.exit(1);
});
