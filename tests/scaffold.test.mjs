import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import path from "node:path";
import { fileURLToPath } from "node:url";

async function readCommandCentreSource() {
  const baseDir = fileURLToPath(new URL("../src/components/command-centre/", import.meta.url));
  const entries = await readdir(baseDir, { recursive: true, withFileTypes: true });
  const fileContents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.(tsx|ts)$/.test(entry.name))
      .map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8"))
  );
  return fileContents.join("\n");
}

test("project scaffold exposes required npm scripts", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs && tsx --test tests/*.test.ts");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
});

test("application shell uses approved product name", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const shell = await readCommandCentreSource();
  assert.match(page, /CommandCentreShell/);
  assert.match(shell, /Developer Agentic OS/);
  assert.doesNotMatch(shell, /Robonuggets|YouTube/i);
});

test("application shell includes approved command centre panels", async () => {
  const shell = await readCommandCentreSource();
  for (const panel of [
    "Micro Apps",
    "Calendar",
    "Artifacts",
    "Second Brain",
    "Email",
    "Skills Deck",
    "Routines",
  ]) {
    assert.match(shell, new RegExp(panel));
  }
});

test("application shell includes persisted layout resizing controls", async () => {
  const shell = await readCommandCentreSource();
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(shell, /developer-agentic-os-layout-v1/);
  assert.match(shell, /ResizeObserver/);
  assert.match(shell, /Reset Layout/);
  assert.match(shell, /page-width-control/);
  assert.match(shell, /orbit-size-control/);
  assert.match(css, /resize: both/);
  assert.match(css, /resize: vertical/);
});
