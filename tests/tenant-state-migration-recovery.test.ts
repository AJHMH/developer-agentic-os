import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const deploymentMigrationPath = resolve(
  process.cwd(),
  "migrations/003-hosted-deployment-normalization.sql"
);
const initMigrationPath = resolve(process.cwd(), "migrations/001-init.sql");
const stateMigrationPath = resolve(process.cwd(), "migrations/004-hosted-state-normalization.sql");
const guidePath = resolve(process.cwd(), "NEON-MIGRATION-GUIDE.md");
const webhookRepositoryPath = resolve(
  process.cwd(),
  "src/server/hosted-deployments/neon-vercel-webhook-repository.ts"
);

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("deployment migration resolves legacy tenants per tenant, records status, and keeps sources for recovery", async () => {
  const sql = await read(deploymentMigrationPath);

  assert.match(
    sql,
    /FOR legacy_tenant_id IN\s+SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_project_mapping/
  );
  assert.match(
    sql,
    /WHERE organizations\.id::text = legacy_tenant_id OR organizations\.clerk_org_id = legacy_tenant_id/
  );
  assert.match(
    sql,
    /INSERT INTO migration_status[\s\S]*'developer_agentic_os_vercel_project_mapping'[\s\S]*'vercel_projects'[\s\S]*'003-hosted-deployment-normalization'[\s\S]*'in_progress'/
  );
  assert.match(sql, /SET status = 'completed', completed_at = NOW\(\), failure_details = NULL/);
  assert.match(sql, /'003-hosted-deployment-normalization', 'failed', NULL, failure_message/);
  assert.match(
    sql,
    /IF cardinality\(failed_tenants\) = 0 THEN\s+DROP TABLE IF EXISTS developer_agentic_os_vercel_project_mapping;/
  );
});

test("deployment migration adds retry-safe dedupe guards for history and audit imports", async () => {
  const sql = await read(deploymentMigrationPath);

  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_project_history_dedup\s+ON vercel_project_history\(tenant_id, vercel_project_id, COALESCE\(vercel_team_id, ''\), changed_at\);/
  );
  assert.match(
    sql,
    /FROM developer_agentic_os_vercel_project_history AS legacy[\s\S]*ON CONFLICT DO NOTHING;/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_audit_dedup\s+ON vercel_webhook_audit\(COALESCE\(tenant_id::text, ''\), action, COALESCE\(vercel_project_id, ''\), occurred_at\);/
  );
  assert.match(
    sql,
    /INSERT INTO vercel_webhook_audit \(tenant_id, action, vercel_project_id, occurred_at\)[\s\S]*ON CONFLICT DO NOTHING;/
  );
});

test("canonical webhook tables and runtime writes use tenant-scoped conflict keys", async () => {
  const initSql = await read(initMigrationPath);
  const deploymentSql = await read(deploymentMigrationPath);
  const repository = await read(webhookRepositoryPath);

  assert.match(
    initSql,
    /UNIQUE \(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id,\s*event_type\)/
  );
  assert.match(
    initSql,
    /ON vercel_webhook_events\(tenant_id,\s*delivery_id\) WHERE delivery_id IS NOT NULL/
  );
  assert.match(initSql, /PRIMARY KEY \(tenant_id,\s*vercel_project_id,\s*vercel_deployment_id\)/);
  assert.match(
    deploymentSql,
    /ADD CONSTRAINT vercel_webhook_events_tenant_event_key[\s\S]*UNIQUE \(tenant_id, vercel_project_id, vercel_deployment_id, event_type\)/
  );
  assert.match(
    deploymentSql,
    /ADD PRIMARY KEY \(tenant_id, vercel_project_id, vercel_deployment_id\)/
  );
  assert.match(
    deploymentSql,
    /ON CONFLICT \(tenant_id, vercel_project_id, vercel_deployment_id, event_type\) DO NOTHING;/
  );
  assert.match(
    deploymentSql,
    /ON CONFLICT \(tenant_id, vercel_project_id, vercel_deployment_id\) DO UPDATE SET/
  );
  assert.match(
    repository,
    /ON CONFLICT \(tenant_id, vercel_project_id, vercel_deployment_id\) DO UPDATE SET/
  );
});

test("hosted state migration preserves workspace identity membership and deterministic retries", async () => {
  const sql = await read(stateMigrationPath);

  assert.match(
    sql,
    /FOR legacy_tenant_id IN\s+SELECT DISTINCT tenant_id FROM developer_agentic_os_workspace_state/
  );
  assert.match(
    sql,
    /INSERT INTO hosted_workspace_members \(tenant_id, workspace_id, user_id, active_workspace\)/
  );
  assert.match(
    sql,
    /NULLIF\(users\.value->>'activeWorkspaceId', ''\)::uuid = \(workspace->>'id'\)::uuid/
  );
  assert.match(
    sql,
    /INSERT INTO migration_status[\s\S]*'developer_agentic_os_workspace_state'[\s\S]*'hosted_workspace_tables'[\s\S]*'004-hosted-state-normalization'[\s\S]*'in_progress'/
  );
  assert.match(
    sql,
    /IF cardinality\(failed_tenants\) = 0 THEN\s+DROP TABLE IF EXISTS developer_agentic_os_workspace_state;/
  );
  assert.match(
    sql,
    /uuid_generate_v5\([\s\S]*uuid_ns_url\(\)[\s\S]*format\('%s:%s:%s:%s', resolved_tenant_id, records\.key, kinds\.key, record\.ordinality\)/
  );
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING;/);
});

test("migration guide documents recovery via per-tenant status and retained legacy tables", async () => {
  const guide = await read(guidePath);

  assert.match(guide, /## Hosted Legacy-Table Recovery/);
  assert.match(guide, /Each tenant writes a `migration_status` row/);
  assert.match(
    guide,
    /if any tenant fails, the migration keeps\s+the legacy source table in place instead of dropping it/i
  );
  assert.match(guide, /Re-run the canonical migrations; completed tenants are safe to retry\./);
});
