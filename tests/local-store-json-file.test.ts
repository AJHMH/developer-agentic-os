import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeJsonFile } from "../src/server/local-store/json-file";

test("json file writer persists JSON data and rejects non-JSON values", async () => {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-json-file-"));
  try {
    const path = join(root, "state.json");
    await writeJsonFile(path, { ok: true, count: 1, omitted: undefined });

    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ok: true, count: 1 });
    await assert.rejects(() => writeJsonFile(path, { bad: Number.NaN }), /non-finite/);
    await assert.rejects(() => writeJsonFile(path, { bad: new Date() }), /JSON-serializable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
