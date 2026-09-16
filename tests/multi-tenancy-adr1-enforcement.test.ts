import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const migrationPath = resolve(process.cwd(), "migrations/001-init.sql");
const migrationScriptPath = resolve(process.cwd(), "scripts/migrate-to-neon.ts");

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("migration enforces tenant-scoped foreign keys across tenant-owned relationships", async () => {
  const sql = await read(migrationPath);
  const requiredCompositeForeignKeys = [
    /FOREIGN KEY \(tenant_id,\s*repo_id\) REFERENCES repos\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
    /FOREIGN KEY \(tenant_id,\s*related_work_item\) REFERENCES work_items\(tenant_id,\s*id\) ON DELETE SET NULL/gi,
    /FOREIGN KEY \(tenant_id,\s*related_artifact\) REFERENCES artifacts\(tenant_id,\s*id\) ON DELETE SET NULL/gi,
    /FOREIGN KEY \(tenant_id,\s*skill_id\) REFERENCES skills\(tenant_id,\s*id\) ON DELETE SET NULL/gi,
    /FOREIGN KEY \(tenant_id,\s*result_artifact_id\) REFERENCES artifacts\(tenant_id,\s*id\) ON DELETE SET NULL/gi,
    /FOREIGN KEY \(tenant_id,\s*routine_id\) REFERENCES routines\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
    /FOREIGN KEY \(tenant_id,\s*source_node_id\) REFERENCES graph_nodes\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
    /FOREIGN KEY \(tenant_id,\s*target_node_id\) REFERENCES graph_nodes\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
    /FOREIGN KEY \(tenant_id,\s*work_item_id\) REFERENCES work_items\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
    /FOREIGN KEY \(tenant_id,\s*artifact_id\) REFERENCES artifacts\(tenant_id,\s*id\) ON DELETE CASCADE/gi,
  ];

  for (const pattern of requiredCompositeForeignKeys) {
    assert.match(sql, pattern);
  }
});

test("migration removes global email uniqueness and scopes it by tenant", async () => {
  const sql = await read(migrationPath);
  assert.doesNotMatch(sql, /email_message_id VARCHAR\(255\)\s+UNIQUE/i);
  assert.match(sql, /UNIQUE \(tenant_id,\s*email_message_id\)/i);
});

test("migration script upserts artifacts and work items by tenant-scoped conflict keys", async () => {
  const script = await read(migrationScriptPath);
  assert.equal(
    (script.match(/ON CONFLICT \(tenant_id,\s*id\) DO NOTHING/g) ?? []).length >= 2,
    true
  );
  assert.doesNotMatch(script, /ON CONFLICT \(id\) DO NOTHING/);
});

test("migration script migrates handoffs under the active tenant", async () => {
  const script = await read(migrationScriptPath);
  assert.match(
    script,
    /INSERT\s+INTO\s+handoffs\s*\(\s*id\s*,\s*tenant_id\s*,\s*title\s*,\s*session_date\s*,\s*repo_context\s*,\s*current_branch\s*,\s*changed_files\s*,\s*work_items_summary\s*,\s*artifacts_summary\s*,\s*decisions\s*,\s*blockers\s*,\s*next_actions\s*,\s*is_draft\s*,\s*created_at\s*,\s*finalized_at\s*\)/i
  );
  assert.match(script, /ON CONFLICT\s*\(\s*tenant_id\s*,\s*id\s*\)\s*DO NOTHING/i);
});
