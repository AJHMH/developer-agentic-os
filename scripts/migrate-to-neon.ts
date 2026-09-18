#!/usr/bin/env node

/**
 * Canonical Migration Script: local JSON → Neon PostgreSQL
 *
 * Applies the canonical Neon schema, provisions the target organizations row for
 * CLERK_ORG_ID, and optionally imports existing state from .developer-agentic-os/.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-neon.ts
 *
 * Environment variables required:
 *   - DATABASE_URL: Neon PostgreSQL connection string
 *   - CLERK_ORG_ID: Target Clerk org ID (creates organizations table entry)
 */

import { neonConfig, Pool } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "@neondatabase/serverless";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

neonConfig.webSocketConstructor = WebSocket;

const DATABASE_URL = process.env.DATABASE_URL;
const CLERK_ORG_ID = process.env.CLERK_ORG_ID?.trim();

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!CLERK_ORG_ID) {
  console.error("ERROR: CLERK_ORG_ID environment variable is required");
  process.exit(1);
}

interface MigrationState {
  artifacts: Record<string, unknown>[];
  workItems: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  routines: Record<string, unknown>[];
  handoffs: Record<string, unknown>[];
  repos: Record<string, unknown>[];
}

const pool = new Pool({ connectionString: DATABASE_URL });

const canonicalMigrations = [
  "migrations/001-init.sql",
  "migrations/003-hosted-deployment-normalization.sql",
  "migrations/004-hosted-state-normalization.sql",
] as const;

const legacyMigrationVersions = new Map<string, string>([
  ["001-init", "001-init.sql"],
  ["003-hosted-deployment-normalization", "003-hosted-deployment-normalization.sql"],
  ["004-hosted-state-normalization", "004-hosted-state-normalization.sql"],
]);

async function recordCanonicalMigrationVersion(client: PoolClient, version: string): Promise<void> {
  await client.query(
    `INSERT INTO schema_migrations (version)
     SELECT $1
     WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`,
    [version]
  );
}

async function retireLegacyMigrationVersionAliases(client: PoolClient): Promise<void> {
  for (const [legacyVersion, canonicalVersion] of legacyMigrationVersions) {
    await client.query(
      `WITH canonicalized AS (
         INSERT INTO schema_migrations (version)
         SELECT $2
         WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)
           AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $2)
       )
       DELETE FROM schema_migrations
       WHERE version = $1`,
      [legacyVersion, canonicalVersion]
    );
  }
}

async function applyCanonicalMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await retireLegacyMigrationVersionAliases(client);

  for (const migrationPath of canonicalMigrations) {
    const version = migrationPath.split("/").at(-1) ?? migrationPath;
    const applied = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version]
    );
    if (applied.rowCount) continue;

    const sql = await readFile(join(process.cwd(), migrationPath), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await retireLegacyMigrationVersionAliases(client);
      await recordCanonicalMigrationVersion(client, version);
      await client.query("COMMIT");
      console.log(`✓ Applied ${version}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${version} failed.`, { cause: error });
    }
  }
}

async function assertCanonicalSchema(client: PoolClient): Promise<void> {
  const requiredTables = [
    "organizations",
    "repos",
    "artifacts",
    "work_items",
    "skills",
    "routines",
    "handoffs",
    "migration_status",
  ];
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables]
  );
  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length > 0)
    throw new Error(`Canonical schema is incomplete. Missing tables: ${missing.join(", ")}.`);
}

async function recordMigrationStatus(
  client: PoolClient,
  tenantId: string,
  status: "completed" | "failed",
  failureDetails?: string
): Promise<void> {
  await client.query(
    `INSERT INTO migration_status
      (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       failure_details = EXCLUDED.failure_details`,
    [
      tenantId,
      "local-json",
      "normalized-neon",
      "hosted-state-import-v1",
      status,
      status === "completed" ? new Date() : null,
      failureDetails ?? null,
    ]
  );
}

async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function createOrGetTenant(client: PoolClient): Promise<string> {
  console.log("Creating or retrieving provisioned tenant...");

  // Check if tenant exists
  const existing = await client.query("SELECT id FROM organizations WHERE clerk_org_id = $1", [
    CLERK_ORG_ID,
  ]);

  if (existing.rows.length > 0) {
    console.log(`✓ Tenant already exists: ${existing.rows[0].id}`);
    return existing.rows[0].id;
  }

  // Create new tenant
  const tenantId = randomUUID();
  await client.query("INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)", [
    tenantId,
    "Test Organization",
    CLERK_ORG_ID,
  ]);

  console.log(`✓ Created new tenant: ${tenantId}`);
  return tenantId;
}

async function migrateArtifacts(
  client: PoolClient,
  tenantId: string,
  data: unknown[]
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No artifacts to migrate");
    return;
  }

  console.log(`Migrating ${data.length} artifacts...`);

  for (const artifact of data) {
    const record = artifact as Record<string, unknown>;
    try {
      await client.query(
        `INSERT INTO artifacts (id, tenant_id, type, title, content, created_at, updated_at, is_draft, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.type || "artifact",
          record.title || "Untitled",
          record.content || "",
          record.created_at || new Date(),
          record.updated_at || new Date(),
          record.is_draft ?? false,
          record.tags ? JSON.stringify(record.tags) : null,
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate artifact ${record.id}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} artifacts`);
}

async function migrateWorkItems(
  client: PoolClient,
  tenantId: string,
  data: unknown[]
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No work items to migrate");
    return;
  }

  console.log(`Migrating ${data.length} work items...`);

  for (const item of data) {
    const record = item as Record<string, unknown>;
    try {
      await client.query(
        `INSERT INTO work_items (id, tenant_id, title, description, status, priority, due_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.title || "Untitled",
          record.description || "",
          record.status || "open",
          record.priority || "medium",
          record.due_date || null,
          record.created_at || new Date(),
          record.updated_at || new Date(),
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate work item ${record.id}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} work items`);
}

async function migrateSkills(client: PoolClient, tenantId: string, data: unknown[]): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No skills to migrate");
    return;
  }

  console.log(`Migrating ${data.length} skills...`);

  for (const skill of data) {
    const record = skill as Record<string, unknown>;
    try {
      await client.query(
        `INSERT INTO skills (id, tenant_id, command, display_name, description, model, effort_level, is_builtin, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, command) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.command || "",
          record.display_name || record.command || "Skill",
          record.description || "",
          record.model || "claude-3.5-sonnet",
          record.effort_level || "medium",
          record.is_builtin ?? false,
          record.is_active ?? true,
          record.created_at || new Date(),
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate skill ${record.command}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} skills`);
}

async function migrateRoutines(
  client: PoolClient,
  tenantId: string,
  data: unknown[]
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No routines to migrate");
    return;
  }

  console.log(`Migrating ${data.length} routines...`);

  for (const routine of data) {
    const record = routine as Record<string, unknown>;
    try {
      await client.query(
        `INSERT INTO routines (id, tenant_id, name, description, schedule, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, name) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.name || "Routine",
          record.description || "",
          record.schedule || "",
          record.is_active ?? true,
          record.created_at || new Date(),
          record.updated_at || new Date(),
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate routine ${record.name}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} routines`);
}

async function migrateRepos(client: PoolClient, tenantId: string, data: unknown[]): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No repos to migrate");
    return;
  }

  console.log(`Migrating ${data.length} repos...`);

  for (const repo of data) {
    const record = repo as Record<string, unknown>;
    try {
      await client.query(
        `INSERT INTO repos (id, tenant_id, github_owner, github_repo, github_url, default_branch, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, github_owner, github_repo) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.github_owner || "",
          record.github_repo || "",
          record.github_url || "",
          record.default_branch || "main",
          record.is_active ?? true,
          record.created_at || new Date(),
          record.updated_at || new Date(),
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate repo ${record.github_repo}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} repos`);
}

async function migrateHandoffs(
  client: PoolClient,
  tenantId: string,
  data: unknown[]
): Promise<void> {
  if (!Array.isArray(data) || data.length === 0) {
    console.log("  No handoffs to migrate");
    return;
  }

  console.log(`Migrating ${data.length} handoffs...`);

  for (const handoff of data) {
    const record = handoff as Record<string, unknown>;
    const snapshot = (record.snapshot as Record<string, unknown>) ?? {};
    const repositoryContext = (snapshot.repositoryContext as Record<string, unknown>) ?? {};
    const workItems = Array.isArray(snapshot.workItems) ? snapshot.workItems : [];
    const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
    const changedFiles = Array.isArray(snapshot.changedFiles) ? snapshot.changedFiles : [];
    const decisions = Array.isArray(record.decisions) ? record.decisions : [];
    const blockers = Array.isArray(record.blockers) ? record.blockers : [];
    const nextActions = Array.isArray(record.nextActions) ? record.nextActions : [];

    try {
      await client.query(
        `INSERT INTO handoffs (
           id, tenant_id, title, session_date, repo_context, current_branch, changed_files,
           work_items_summary, artifacts_summary, decisions, blockers, next_actions,
           is_draft, created_at, finalized_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [
          record.id || randomUUID(),
          tenantId,
          record.title || "Session Handoff",
          record.finalizedAt || record.updatedAt || record.createdAt || new Date(),
          (repositoryContext.id as string | undefined) ?? record.repo_context ?? null,
          (snapshot.branch as string | undefined) ?? record.current_branch ?? null,
          JSON.stringify(changedFiles),
          JSON.stringify(workItems),
          JSON.stringify(artifacts),
          JSON.stringify(decisions),
          blockers.join("\n") || null,
          nextActions.join("\n") || null,
          record.status !== "finalized",
          record.createdAt || record.created_at || new Date(),
          record.finalizedAt || record.finalized_at || null,
        ]
      );
    } catch (error) {
      console.warn(`  ⚠ Failed to migrate handoff ${record.title}:`, error);
    }
  }

  console.log(`✓ Migrated ${data.length} handoffs`);
}

async function loadExistingState(): Promise<MigrationState> {
  console.log("Loading existing state from .developer-agentic-os/...");

  const localStorePath = join(process.cwd(), ".developer-agentic-os");
  const state: MigrationState = {
    artifacts: [],
    workItems: [],
    skills: [],
    routines: [],
    handoffs: [],
    repos: [],
  };

  // Try to read each file type
  const files = [
    { key: "artifacts", file: "artifacts.json" },
    { key: "workItems", file: "work-items.json" },
    { key: "skills", file: "skills.json" },
    { key: "routines", file: "routines.json" },
    { key: "handoffs", file: "handoffs.json" },
    { key: "repos", file: "repos.json" },
  ];

  for (const { key, file } of files) {
    const path = join(localStorePath, file);
    const data = await readJsonFile(path);

    if (Array.isArray(data)) {
      (state[key as keyof MigrationState] as unknown[]) = data;
      console.log(`  ✓ Loaded ${data.length} ${key}`);
    } else if (data && typeof data === "object") {
      // If it's a single object, wrap in array
      (state[key as keyof MigrationState] as unknown[]) = [data];
      console.log(`  ✓ Loaded 1 ${key}`);
    } else {
      console.log(`  - No ${key} found`);
    }
  }

  return state;
}

async function main() {
  const client = await getClient();
  let tenantId: string | undefined;

  try {
    console.log("🚀 Starting canonical migration: local JSON → Neon");
    console.log("=====================================\n");

    console.log("Applying canonical migrations...");
    await applyCanonicalMigrations(client);
    await assertCanonicalSchema(client);
    console.log("✓ Canonical schema is ready\n");

    // Create or get tenant
    tenantId = await createOrGetTenant(client);
    console.log();

    // Load existing state
    const state = await loadExistingState();
    console.log();

    // Migrate each data type
    await migrateArtifacts(client, tenantId, state.artifacts);
    await migrateWorkItems(client, tenantId, state.workItems);
    await migrateSkills(client, tenantId, state.skills);
    await migrateRoutines(client, tenantId, state.routines);
    await migrateRepos(client, tenantId, state.repos);
    await migrateHandoffs(client, tenantId, state.handoffs);
    await recordMigrationStatus(client, tenantId, "completed");

    console.log("\n=====================================");
    console.log("✅ Migration complete!");
    console.log(`\nAll data migrated to tenant: ${tenantId}`);
    console.log(`Clerk org ID: ${CLERK_ORG_ID}\n`);
  } catch (error) {
    if (tenantId) {
      try {
        await recordMigrationStatus(
          client,
          tenantId,
          "failed",
          error instanceof Error ? error.message : String(error)
        );
      } catch (statusError) {
        console.error("Failed to record migration failure status:", statusError);
      }
    }
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
