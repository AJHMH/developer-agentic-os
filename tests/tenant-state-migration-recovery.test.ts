import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const deploymentMigrationPath = resolve(
  process.cwd(),
  "migrations/003-hosted-deployment-normalization.sql"
);
const initMigrationPath = resolve(process.cwd(), "migrations/001-init.sql");
const stateMigrationPath = resolve(process.cwd(), "migrations/004-hosted-state-normalization.sql");
const guidePath = resolve(process.cwd(), "NEON-MIGRATION-GUIDE.md");
const systemDiagramsPath = resolve(process.cwd(), "docs/system-diagrams.md");
const webhookRepositoryPath = resolve(
  process.cwd(),
  "src/server/hosted-deployments/neon-vercel-webhook-repository.ts"
);

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function createPgLite(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid AS $$
      SELECT (
        substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 9, 4) || '-' ||
        '4' || substr(md5(random()::text || clock_timestamp()::text), 14, 3) || '-' ||
        'a' || substr(md5(random()::text || clock_timestamp()::text), 18, 3) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 21, 12)
      )::uuid;
    $$ LANGUAGE SQL;
    CREATE OR REPLACE FUNCTION uuid_ns_url() RETURNS uuid AS $$
      SELECT '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid;
    $$ LANGUAGE SQL IMMUTABLE;
    CREATE OR REPLACE FUNCTION uuid_generate_v5(namespace uuid, name text) RETURNS uuid AS $$
      SELECT (
        substr(md5(namespace::text || ':' || name), 1, 8) || '-' ||
        substr(md5(namespace::text || ':' || name), 9, 4) || '-' ||
        '5' || substr(md5(namespace::text || ':' || name), 14, 3) || '-' ||
        'a' || substr(md5(namespace::text || ':' || name), 18, 3) || '-' ||
        substr(md5(namespace::text || ':' || name), 21, 12)
      )::uuid;
    $$ LANGUAGE SQL IMMUTABLE;
  `);
  return db;
}

async function applyMigration(db: PGlite, path: string): Promise<void> {
  const sql = (await read(path)).replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n\n/, "");
  await db.exec(sql);
}

async function tableExists(db: PGlite, tableName: string): Promise<boolean> {
  const result = await db.query<{ present: number }>(
    `SELECT COUNT(*)::int AS present
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = '${tableName}'`
  );
  return Number(result.rows[0]?.present ?? 0) === 1;
}

async function rowCount(db: PGlite, tableName: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${tableName}`
  );
  return Number(result.rows[0]?.count ?? 0);
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
  assert.match(deploymentSql, /PRIMARY KEY \(tenant_id, source_id\)/);
  assert.match(deploymentSql, /ON CONFLICT \(tenant_id, source_id\) DO NOTHING;/);
  assert.match(
    repository,
    /ON CONFLICT ON CONSTRAINT vercel_deployment_projections_pkey DO UPDATE SET/
  );
  assert.match(repository, /ON CONFLICT ON CONSTRAINT vercel_failure_signals_pkey DO NOTHING/);
});

test("deployment migration execution preserves per-tenant webhook and projection rows across retries", async () => {
  const db = await createPgLite();
  try {
    await applyMigration(db, initMigrationPath);
    await db.exec(`
      INSERT INTO organizations (id, name, clerk_org_id) VALUES
        ('00000000-0000-0000-0000-000000000001', 'Tenant A', 'org-a'),
        ('00000000-0000-0000-0000-000000000002', 'Tenant B', 'org-b');

      CREATE TABLE developer_agentic_os_vercel_project_mapping (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        team_id VARCHAR(255),
        webhook_secret_reference VARCHAR(512),
        previous_webhook_secret_reference VARCHAR(512),
        previous_webhook_secret_expires_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_project_history (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        team_id VARCHAR(255),
        updated_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_webhook_events (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        delivery_id VARCHAR(255),
        status VARCHAR(50),
        url VARCHAR(255),
        commit_sha VARCHAR(255),
        payload JSONB NOT NULL,
        raw_expires_at TIMESTAMP NOT NULL,
        occurred_at TIMESTAMP NOT NULL,
        received_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_deployment_projection (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        status VARCHAR(50),
        url VARCHAR(255),
        commit_sha VARCHAR(255),
        occurred_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_webhook_audit (
        tenant_id TEXT NOT NULL,
        action VARCHAR(100) NOT NULL,
        project_id VARCHAR(255),
        occurred_at TIMESTAMP
      );
      CREATE TABLE developer_agentic_os_vercel_failure_signals (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        source_id VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL
      );

      INSERT INTO developer_agentic_os_vercel_project_mapping VALUES
        ('org-a', 'shared-project', 'shared-team', 'secret-a', NULL, NULL, '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-team', 'secret-b', NULL, NULL, '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_project_history VALUES
        ('org-a', 'shared-project', 'shared-team', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-team', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_webhook_events VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'ready', 'delivery-1', 'ready', 'https://a.example', 'sha-a', '{"tenant":"a"}', '2026-01-08T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'ready', 'delivery-1', 'ready', 'https://b.example', 'sha-b', '{"tenant":"b"}', '2026-01-08T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_deployment_projection VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'ready', 'ready', 'https://a.example', 'sha-a', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'ready', 'ready', 'https://b.example', 'sha-b', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_webhook_audit VALUES
        ('org-a', 'duplicate', 'shared-project', '2026-01-01T00:00:00Z'),
        ('org-b', 'duplicate', 'shared-project', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_failure_signals VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'shared-source', 'Fail A', 'Body A', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'shared-source', 'Fail B', 'Body B', '2026-01-01T00:00:00Z');
    `);

    await applyMigration(db, deploymentMigrationPath);
    assert.equal(await rowCount(db, "vercel_projects"), 2);
    assert.equal(await rowCount(db, "vercel_project_history"), 2);
    assert.equal(await rowCount(db, "vercel_webhook_events"), 2);
    assert.equal(await rowCount(db, "vercel_deployment_projections"), 2);
    assert.equal(await rowCount(db, "vercel_webhook_audit"), 2);
    assert.equal(await rowCount(db, "vercel_failure_signals"), 2);
    assert.equal(await tableExists(db, "developer_agentic_os_vercel_webhook_events"), false);

    await db.exec(`
      CREATE TABLE developer_agentic_os_vercel_project_mapping (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        team_id VARCHAR(255),
        webhook_secret_reference VARCHAR(512),
        previous_webhook_secret_reference VARCHAR(512),
        previous_webhook_secret_expires_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_project_history (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        team_id VARCHAR(255),
        updated_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_webhook_events (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        delivery_id VARCHAR(255),
        status VARCHAR(50),
        url VARCHAR(255),
        commit_sha VARCHAR(255),
        payload JSONB NOT NULL,
        raw_expires_at TIMESTAMP NOT NULL,
        occurred_at TIMESTAMP NOT NULL,
        received_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_deployment_projection (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        status VARCHAR(50),
        url VARCHAR(255),
        commit_sha VARCHAR(255),
        occurred_at TIMESTAMP NOT NULL
      );
      CREATE TABLE developer_agentic_os_vercel_webhook_audit (
        tenant_id TEXT NOT NULL,
        action VARCHAR(100) NOT NULL,
        project_id VARCHAR(255),
        occurred_at TIMESTAMP
      );
      CREATE TABLE developer_agentic_os_vercel_failure_signals (
        tenant_id TEXT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        deployment_id VARCHAR(255) NOT NULL,
        source_id VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL
      );

      INSERT INTO developer_agentic_os_vercel_project_mapping VALUES
        ('org-a', 'shared-project', 'shared-team', 'secret-a', NULL, NULL, '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-team', 'secret-b', NULL, NULL, '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_project_history VALUES
        ('org-a', 'shared-project', 'shared-team', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-team', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_webhook_events VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'ready', 'delivery-1', 'ready', 'https://a.example', 'sha-a', '{"tenant":"a"}', '2026-01-08T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'ready', 'delivery-1', 'ready', 'https://b.example', 'sha-b', '{"tenant":"b"}', '2026-01-08T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_deployment_projection VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'ready', 'ready', 'https://a.example', 'sha-a', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'ready', 'ready', 'https://b.example', 'sha-b', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_webhook_audit VALUES
        ('org-a', 'duplicate', 'shared-project', '2026-01-01T00:00:00Z'),
        ('org-b', 'duplicate', 'shared-project', '2026-01-01T00:00:00Z');
      INSERT INTO developer_agentic_os_vercel_failure_signals VALUES
        ('org-a', 'shared-project', 'shared-deployment', 'shared-source', 'Fail A', 'Body A', '2026-01-01T00:00:00Z'),
        ('org-b', 'shared-project', 'shared-deployment', 'shared-source', 'Fail B', 'Body B', '2026-01-01T00:00:00Z');
    `);

    await applyMigration(db, deploymentMigrationPath);
    assert.equal(await rowCount(db, "vercel_projects"), 2);
    assert.equal(await rowCount(db, "vercel_project_history"), 2);
    assert.equal(await rowCount(db, "vercel_webhook_events"), 2);
    assert.equal(await rowCount(db, "vercel_deployment_projections"), 2);
    assert.equal(await rowCount(db, "vercel_webhook_audit"), 2);
    assert.equal(await rowCount(db, "vercel_failure_signals"), 2);
  } finally {
    await db.close();
  }
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

test("hosted state migration execution keeps legacy tables for failed tenants until recovery succeeds", async () => {
  const db = await createPgLite();
  try {
    await applyMigration(db, initMigrationPath);
    await applyMigration(db, deploymentMigrationPath);
    await db.exec(`
      INSERT INTO organizations (id, name, clerk_org_id) VALUES
        ('00000000-0000-0000-0000-000000000010', 'Tenant Good', 'org-good');

      CREATE TABLE developer_agentic_os_workspace_state (
        tenant_id TEXT NOT NULL,
        state JSONB NOT NULL
      );

      INSERT INTO developer_agentic_os_workspace_state VALUES
        ('org-good', '{"users":{"alice":{"activeWorkspaceId":"10000000-0000-0000-0000-000000000001","workspaces":[{"id":"10000000-0000-0000-0000-000000000001","name":"Good Workspace","createdAt":"2026-01-01T00:00:00Z"}]}},"audit":[{"id":"20000000-0000-0000-0000-000000000001","userId":"alice","workspaceId":"10000000-0000-0000-0000-000000000001","action":"workspace.created","occurredAt":"2026-01-01T00:00:00Z"}]}'::jsonb),
        ('11111111-1111-1111-1111-111111111111', '{"users":{"bob":{"activeWorkspaceId":"10000000-0000-0000-0000-000000000002","workspaces":[{"id":"10000000-0000-0000-0000-000000000002","name":"Blocked Workspace","createdAt":"2026-01-01T00:00:00Z"}]}},"audit":[]}'::jsonb);
    `);

    await applyMigration(db, stateMigrationPath);
    assert.equal(await rowCount(db, "hosted_workspaces"), 1);
    assert.equal(await rowCount(db, "hosted_workspace_members"), 1);
    assert.equal(await tableExists(db, "developer_agentic_os_workspace_state"), true);

    await db.exec(`
      INSERT INTO organizations (id, name, clerk_org_id) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Tenant Recovered', 'org-recovered');
    `);
    await applyMigration(db, stateMigrationPath);

    assert.equal(await rowCount(db, "hosted_workspaces"), 2);
    assert.equal(await rowCount(db, "hosted_workspace_members"), 2);
    assert.equal(await rowCount(db, "hosted_workspace_users"), 2);
    assert.equal(await tableExists(db, "developer_agentic_os_workspace_state"), false);
  } finally {
    await db.close();
  }
});

test("migration guide documents recovery via per-tenant status and retained legacy tables", async () => {
  const guide = await read(guidePath);
  const diagrams = await read(systemDiagramsPath);

  assert.match(guide, /## Hosted Legacy-Table Recovery/);
  assert.match(guide, /Each tenant writes a `migration_status` row/);
  assert.match(
    guide,
    /if any tenant fails, the migration keeps\s+the legacy source table in place instead of dropping it/i
  );
  assert.match(guide, /Re-run the canonical migrations; completed tenants are safe to retry\./);
  assert.match(
    diagrams,
    /Migration `004-hosted-state-normalization\.sql` backfills legacy JSONB state tenant-by-tenant, records migration status, and only drops the retired blob tables after every tenant succeeds\./
  );
});
