import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Pool } from "@neondatabase/serverless";

type QueryResultLike<Row> = { rowCount: number | null; rows: Row[] };
type Queryable = {
  query<Row = unknown>(query: string, values?: unknown[]): Promise<QueryResultLike<Row>>;
};

export const canonicalHostedSchemaMigrations = [
  "migrations/005-hosted-canonical-contract.sql",
] as const;

export const canonicalHostedSchemaTables = [
  "organizations",
  "repos",
  "vercel_projects",
  "vercel_project_history",
  "migration_status",
  "vercel_failure_signals",
  "vercel_webhook_events",
  "vercel_deployment_projections",
  "vercel_webhook_audit",
  "hosted_workspaces",
  "hosted_workspace_members",
  "hosted_workspace_users",
  "hosted_workspace_audit",
  "hosted_repositories",
  "hosted_records",
  "hosted_relationships",
  "hosted_snapshots",
  "hosted_connectors",
  "hosted_credentials",
  "hosted_audit",
] as const;

export const canonicalHostedStateTables = [
  "organizations",
  "hosted_workspaces",
  "hosted_workspace_members",
  "hosted_workspace_users",
  "hosted_workspace_audit",
  "hosted_repositories",
  "hosted_records",
  "hosted_relationships",
  "hosted_snapshots",
  "hosted_connectors",
  "hosted_credentials",
  "hosted_audit",
] as const;

export const canonicalHostedDeploymentTables = [
  "organizations",
  "repos",
  "vercel_projects",
  "vercel_project_history",
  "migration_status",
] as const;

export const canonicalHostedWebhookTables = [
  "organizations",
  "vercel_projects",
  "vercel_webhook_events",
  "vercel_deployment_projections",
  "vercel_failure_signals",
  "vercel_webhook_audit",
] as const;

export async function applyCanonicalHostedSchemaMigrations(
  client: Queryable,
  readMigration: (path: string) => Promise<string> = readCanonicalHostedMigration
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  for (const migrationPath of canonicalHostedSchemaMigrations) {
    const version = migrationPath.split("/").at(-1) ?? migrationPath;
    const applied = (await client.query(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version]
    )) as QueryResultLike<{ version: string }>;
    if (applied.rowCount) continue;

    await client.query(await readMigration(migrationPath));
    await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
      [version]
    );
  }
}

export async function assertCanonicalHostedSchema(
  client: Queryable,
  requiredTables: readonly string[]
): Promise<void> {
  const result = (await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables]
  )) as QueryResultLike<{ table_name: string }>;
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length > 0)
    throw new Error(
      `Canonical hosted schema is incomplete. Missing tables: ${missing.join(", ")}.`
    );
}

export async function provisionCanonicalHostedSchema(
  pool: Pool,
  requiredTables: readonly string[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "canonical_hosted_schema:v1",
    ]);
    await applyCanonicalHostedSchemaMigrations(client);
    await assertCanonicalHostedSchema(client, requiredTables);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback cleanup failures so the original provisioning error is preserved.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function assertHostedProductionPersistenceConfigured(): void {
  throw new Error(
    "Hosted runtime requires a supported database URL or explicit HOSTED_JSON_FIXTURE_MODE=true in development/test."
  );
}

async function readCanonicalHostedMigration(path: string): Promise<string> {
  return readFile(join(process.cwd(), "migrations", path.split("/").at(-1) ?? path), "utf8");
}
