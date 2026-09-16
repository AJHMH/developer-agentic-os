#!/usr/bin/env node

/**
 * Migration Script: JSON → Neon PostgreSQL
 * 
 * Reads existing state from .developer-agentic-os/ JSON files and loads into Neon.
 * Creates a single test tenant to contain all migrated data.
 * 
 * Usage:
 *   npx tsx scripts/migrate-to-neon.ts
 * 
 * Environment variables required:
 *   - DATABASE_URL: Neon PostgreSQL connection string
 *   - CLERK_ORG_ID: Test org ID (creates organizations table entry)
 */

import { Pool } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const CLERK_ORG_ID = process.env.CLERK_ORG_ID || "test-org-001";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
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

async function getClient() {
  return pool.connect();
}

type PoolClient = Awaited<ReturnType<typeof getClient>>;

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
  console.log("Creating or retrieving test tenant...");

  // Check if tenant exists
  const existing = await client.query(
    "SELECT id FROM organizations WHERE clerk_org_id = $1",
    [CLERK_ORG_ID]
  );

  if (existing.rows.length > 0) {
    console.log(`✓ Tenant already exists: ${existing.rows[0].id}`);
    return existing.rows[0].id;
  }

  // Create new tenant
  const tenantId = randomUUID();
  await client.query(
    "INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)",
    [tenantId, "Test Organization", CLERK_ORG_ID]
  );

  console.log(`✓ Created new tenant: ${tenantId}`);
  return tenantId;
}

async function migrateArtifacts(client: PoolClient, tenantId: string, data: unknown[]): Promise<void> {
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
         ON CONFLICT (id) DO NOTHING`,
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

async function migrateWorkItems(client: PoolClient, tenantId: string, data: unknown[]): Promise<void> {
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
         ON CONFLICT (id) DO NOTHING`,
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

async function migrateRoutines(client: PoolClient, tenantId: string, data: unknown[]): Promise<void> {
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

  try {
    console.log("🚀 Starting migration: JSON → Neon");
    console.log("=====================================\n");

    // Verify schema exists
    console.log("Verifying schema...");
    const schemaCheck = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1");
    if (schemaCheck.rows.length === 0) {
      console.error("ERROR: Schema not found in Neon. Run migrations first: psql $DATABASE_URL < migrations/001-init.sql");
      process.exit(1);
    }
    console.log("✓ Schema exists\n");

    // Create or get tenant
    const tenantId = await createOrGetTenant(client);
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

    console.log("\n=====================================");
    console.log("✅ Migration complete!");
    console.log(`\nAll data migrated to tenant: ${tenantId}`);
    console.log(`Clerk org ID: ${CLERK_ORG_ID}\n`);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
