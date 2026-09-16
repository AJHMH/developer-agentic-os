import { readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import type { RepoMemoryFile, RepoMemorySnapshot } from "@/types/repo-memory";
import { LocalGitAdapter } from "../git/local-git-adapter";
import { initializeLocalStore } from "../local-store/paths";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";

const ignoredDirectories = new Set([".git", ".next", "node_modules", ".developer-agentic-os"]);

export async function refreshRepoMemorySnapshot(root = process.cwd()): Promise<RepoMemorySnapshot> {
  const paths = await initializeLocalStore(root);
  const files = await listRepoFiles(root);
  const git = await new LocalGitAdapter(root).getStatus();
  const snapshot: RepoMemorySnapshot = {
    repoName: basename(resolve(root)),
    repoPath: resolve(root),
    refreshedAt: new Date().toISOString(),
    files,
    areas: await listAreas(root),
    git,
  };

  await writeJsonFile(resolve(paths.repoMemory, "snapshot.json"), snapshot);
  return snapshot;
}

export async function getRepoMemorySnapshot(root = process.cwd()): Promise<RepoMemorySnapshot> {
  const paths = await initializeLocalStore(root);
  return readJsonFile<RepoMemorySnapshot>(
    resolve(paths.repoMemory, "snapshot.json"),
    await refreshRepoMemorySnapshot(root)
  );
}

async function listAreas(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !ignoredDirectories.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function listRepoFiles(root: string): Promise<RepoMemoryFile[]> {
  const output: RepoMemoryFile[] = [];
  await walk(root, output, root);
  return output.slice(0, 500);
}

async function walk(current: string, output: RepoMemoryFile[], root: string): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = resolve(current, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output, root);
      continue;
    }
    if (!entry.isFile()) continue;
    output.push({
      path: relative(root, fullPath).replace(/\\/g, "/"),
      kind: classifyFile(entry.name, fullPath),
    });
  }
}

function classifyFile(name: string, path: string): RepoMemoryFile["kind"] {
  const lower = `${path}/${name}`.toLowerCase();
  if (lower.includes("test") || lower.includes("/tests/")) return "test";
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt")) return "doc";
  if (
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".config.ts") ||
    lower.endsWith(".config.mjs")
  )
    return "config";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".css")
  )
    return "code";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  )
    return "asset";
  return "other";
}
