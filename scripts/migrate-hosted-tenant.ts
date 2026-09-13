#!/usr/bin/env node

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? process.env.DEV_AGENTIC_OS_DATABASE_URL;
const tenantId = process.env.TENANT_ID?.trim();
const sourceTenantId = process.env.SOURCE_TENANT_ID?.trim() || "legacy";

if (!databaseUrl) throw new Error("DATABASE_URL or DEV_AGENTIC_OS_DATABASE_URL is required.");
if (!tenantId) throw new Error("TENANT_ID is required.");
if (tenantId === sourceTenantId)
  throw new Error("TENANT_ID and SOURCE_TENANT_ID must be different.");

const pool = new Pool({ connectionString: databaseUrl });

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS developer_agentic_os_migration_status (
      tenant_id text PRIMARY KEY,
      source text NOT NULL,
      target text NOT NULL,
      version integer NOT NULL,
      state text NOT NULL,
      started_at timestamptz NOT NULL,
      completed_at timestamptz,
      error text
    )`);
    const legacyTables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('organizations', 'users', 'org_members', 'repos',
         'vercel_projects', 'deployment_events', 'vercel_webhook_events', 'artifacts', 'work_items')`
    );
    if (legacyTables.rows.length)
      throw new Error(
        `Normalized legacy tables require explicit transformation before migration: ${legacyTables.rows
          .map((row) => row.table_name)
          .join(", ")}`
      );
    await client.query("BEGIN");
    const existing = await client.query<{ state: string }>(
      "SELECT state FROM developer_agentic_os_migration_status WHERE tenant_id = $1",
      [tenantId]
    );
    if (existing.rows[0]?.state === "completed") {
      await client.query("COMMIT");
      return;
    }
    const startedAt = new Date().toISOString();
    await client.query(
      `INSERT INTO developer_agentic_os_migration_status
        (tenant_id, source, target, version, state, started_at)
       VALUES ($1, $2, 'tenant-scoped-hosted-provider', 1, 'running', $3)
       ON CONFLICT (tenant_id) DO UPDATE SET state = 'running', error = NULL, started_at = EXCLUDED.started_at`,
      [tenantId, `tenant:${sourceTenantId}`, startedAt]
    );

    await client.query(
      `INSERT INTO developer_agentic_os_hosted_state (tenant_id, state_key, state, updated_at)
       SELECT $1, state_key, state, updated_at
       FROM developer_agentic_os_hosted_state WHERE tenant_id = $2
       ON CONFLICT (tenant_id, state_key) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_workspace_state (tenant_id, state_key, state, updated_at)
       SELECT $1, state_key, state, updated_at
       FROM developer_agentic_os_workspace_state WHERE tenant_id = $2
       ON CONFLICT (tenant_id, state_key) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_vercel_project_mapping
        (tenant_id, project_id, team_id, webhook_secret_reference, previous_webhook_secret_reference,
         previous_webhook_secret_expires_at, updated_at)
       SELECT $1, project_id, team_id, webhook_secret_reference, previous_webhook_secret_reference,
         previous_webhook_secret_expires_at, updated_at
       FROM developer_agentic_os_vercel_project_mapping WHERE tenant_id = $2
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_vercel_project_history (tenant_id, project_id, team_id, updated_at)
       SELECT $1, project_id, team_id, updated_at
       FROM developer_agentic_os_vercel_project_history WHERE tenant_id = $2`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_github_repository_registration
        (id, tenant_id, owner, repository, workflow, ref, created_at)
       SELECT id, $1, owner, repository, workflow, ref, created_at
       FROM developer_agentic_os_github_repository_registration WHERE tenant_id = $2
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_vercel_webhook_events
        (tenant_id, project_id, deployment_id, event_type, delivery_id, status, url, commit_sha,
         payload, raw_expires_at, occurred_at, received_at)
       SELECT $1, project_id, deployment_id, event_type, delivery_id, status, url, commit_sha,
         payload, raw_expires_at, occurred_at, received_at
       FROM developer_agentic_os_vercel_webhook_events WHERE tenant_id = $2
       ON CONFLICT (project_id, deployment_id, event_type) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_vercel_deployment_projection
        (tenant_id, project_id, deployment_id, event_type, status, url, commit_sha, occurred_at)
       SELECT $1, project_id, deployment_id, event_type, status, url, commit_sha, occurred_at
       FROM developer_agentic_os_vercel_deployment_projection WHERE tenant_id = $2
       ON CONFLICT (project_id, deployment_id) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `INSERT INTO developer_agentic_os_vercel_failure_signals
        (tenant_id, project_id, deployment_id, source_id, title, body, created_at)
       SELECT $1, project_id, deployment_id, source_id, title, body, created_at
       FROM developer_agentic_os_vercel_failure_signals WHERE tenant_id = $2
       ON CONFLICT (source_id) DO NOTHING`,
      [tenantId, sourceTenantId]
    );
    await client.query(
      `UPDATE developer_agentic_os_migration_status
       SET state = 'completed', completed_at = now(), error = NULL
       WHERE tenant_id = $1`,
      [tenantId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await client.query(
      `INSERT INTO developer_agentic_os_migration_status
        (tenant_id, source, target, version, state, started_at, error)
       VALUES ($1, $2, 'tenant-scoped-hosted-provider', 1, 'failed', now(), $3)
       ON CONFLICT (tenant_id) DO UPDATE SET state = 'failed', error = EXCLUDED.error`,
      [tenantId, `tenant:${sourceTenantId}`, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  } finally {
    client.release();
  }
}

try {
  await migrate();
} finally {
  await pool.end();
}
