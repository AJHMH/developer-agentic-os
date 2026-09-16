# Neon Migration & Adapter Guide

This guide walks through migrating from local JSON storage to Neon PostgreSQL and using the Neon adapter in the application.

## Overview

Developer Agentic OS v2 uses Neon PostgreSQL for multi-tenant data persistence. The migration process involves:

1. **Schema Creation**: Deploy tables to Neon using SQL migrations
2. **Data Migration**: Transform existing JSON files and load into Neon
3. **Adapter Integration**: Replace JSON file access with Neon queries in the app
4. **Validation**: Test multi-tenant queries and isolation

---

## Step 1: Prerequisites

### 1.1 Neon Database Setup

- [ ] Neon account created at https://neon.tech/
- [ ] Project created in Neon console
- [ ] Database credentials obtained
- [ ] `DATABASE_URL` environment variable set

**Verify connection**:

```bash
psql $DATABASE_URL -c "SELECT 1"
```

### 1.2 Environment Variables

Create `.env.local` (or add to `.env`):

```env
# Neon connection
DATABASE_URL=postgresql://user:password@project.neon.tech/dbname

# Clerk configuration (for auth integration, Phase 2)
CLERK_SECRET_KEY=xxx
CLERK_PUBLISHABLE_KEY=xxx

# GitHub OAuth (for integration, Phase 2)
GITHUB_OAUTH_CLIENT_ID=xxx
GITHUB_OAUTH_CLIENT_SECRET=xxx

# Test/migration configuration
CLERK_ORG_ID=test-org-001  # ID for test tenant during migration
```

### 1.3 Dependencies

Ensure `pg` (PostgreSQL client) is installed:

```bash
npm install pg
npm install --save-dev @types/pg
```

---

## Step 2: Deploy Schema to Neon

### 2.1 Run Migration SQL

Execute the schema creation script:

```bash
psql $DATABASE_URL < migrations/001-init.sql
```

### 2.2 Verify Schema

Check that all tables were created:

```bash
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
"
```

Expected output (24 tables):

- `artifacts`, `deployment_events`, `emails`, `focus_board_items`
- `github_issues`, `github_pull_requests`
- `graph_links`, `graph_nodes`
- `handoffs`
- `incoming_signals`
- `org_members`, `organizations`
- `repos`, `routine_runs`, `routines`
- `schema_migrations`
- `skill_runs`, `skills`
- `users`
- `vercel_projects`
- `work_items`

---

## Step 3: Migrate Existing Data

### 3.1 Run Migration Script

The migration script reads existing JSON files from `.developer-agentic-os/` and loads them into Neon under a single test tenant:

```bash
npx tsx scripts/migrate-to-neon.ts
```

**Output** (example):

```
🚀 Starting migration: JSON → Neon
=====================================

Verifying schema...
✓ Schema exists

Creating or retrieving test tenant...
✓ Created new tenant: abc123de-f456-7890-ghij-klmnopqrstuv

Loading existing state from .developer-agentic-os/...
  ✓ Loaded 5 artifacts
  ✓ Loaded 3 work items
  ✓ Loaded 2 skills
  ✓ Loaded 1 routines
  - No handoffs found
  ✓ Loaded 1 repos

Migrating 5 artifacts...
✓ Migrated 5 artifacts
Migrating 3 work items...
✓ Migrated 3 work items
Migrating 2 skills...
✓ Migrated 2 skills
Migrating 1 routines...
✓ Migrated 1 routines
Migrating 1 repos...
✓ Migrated 1 repos

=====================================
✅ Migration complete!

All data migrated to tenant: abc123de-f456-7890-ghij-klmnopqrstuv
Clerk org ID: test-org-001
```

### 3.2 Note the Tenant ID

Save the tenant ID output from the migration script. It will be used for configuration.

### 3.3 Verify Data in Neon

Check that data was migrated correctly:

```bash
# Count artifacts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM artifacts"

# List work items
psql $DATABASE_URL -c "SELECT title, status FROM work_items LIMIT 5"

# Verify tenant isolation
psql $DATABASE_URL -c "SELECT DISTINCT tenant_id FROM artifacts"
```

---

## Step 4: Integrate Neon Adapter into Application

### 4.1 Update Environment Configuration

In `.env.local`, add the test tenant ID from Step 3.2:

```env
NEON_TENANT_ID=abc123de-f456-7890-ghij-klmnopqrstuv
```

### 4.2 Replace JSON Store with Neon Adapter

Update the application's data access layer to use the Neon adapter instead of JSON files.

**Before** (JSON-based):

```typescript
// src/server/local-store/artifact-store.ts (old)
import { readJsonFile, writeJsonFile } from "./json-file";

export async function getArtifacts() {
  return readJsonFile(".developer-agentic-os/artifacts.json", []);
}

export async function saveArtifact(artifact) {
  const artifacts = await getArtifacts();
  artifacts.push(artifact);
  await writeJsonFile(".developer-agentic-os/artifacts.json", artifacts);
}
```

**After** (Neon-based):

```typescript
// src/server/adapters/neon-artifact-store.ts (new)
import { NeonAdapter } from "./neon-adapter";

export class NeonArtifactStore {
  constructor(private adapter: NeonAdapter) {}

  async getArtifacts() {
    return this.adapter.listArtifacts();
  }

  async saveArtifact(artifact) {
    return this.adapter.createArtifact(artifact);
  }

  async updateArtifact(id, updates) {
    return this.adapter.updateArtifact(id, updates);
  }
}
```

### 4.3 Singleton Adapter Instance

Create a module to provide a singleton adapter instance:

```typescript
// src/server/db.ts (new)
import { createNeonAdapter, NeonAdapter } from "./adapters/neon-adapter";

let adapter: NeonAdapter | null = null;

export function getDbAdapter(): NeonAdapter {
  if (!adapter) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    if (!process.env.NEON_TENANT_ID) {
      throw new Error("NEON_TENANT_ID environment variable is required");
    }
    adapter = createNeonAdapter({
      databaseUrl: process.env.DATABASE_URL,
      tenantId: process.env.NEON_TENANT_ID,
    });
  }
  return adapter;
}
```

### 4.4 Update API Routes

Replace data access in Next.js API routes:

**Before**:

```typescript
// src/app/api/artifacts/route.ts (old)
import { listArtifacts, saveArtifact } from "@/server/local-store/artifact-store";

export async function GET() {
  const artifacts = await listArtifacts();
  return Response.json({ artifacts });
}

export async function POST(req: Request) {
  const artifact = await req.json();
  const saved = await saveArtifact(artifact);
  return Response.json(saved);
}
```

**After**:

```typescript
// src/app/api/artifacts/route.ts (updated)
import { getDbAdapter } from "@/server/db";

export async function GET() {
  const adapter = getDbAdapter();
  const artifacts = await adapter.listArtifacts();
  return Response.json({ artifacts });
}

export async function POST(req: Request) {
  const adapter = getDbAdapter();
  const artifact = await req.json();
  const saved = await adapter.createArtifact(artifact);
  return Response.json(saved);
}
```

---

## Step 5: Validation & Testing

### 5.1 Multi-Tenant Query Test

Verify that queries are properly scoped to the tenant:

```bash
# Create a test script
cat > test-isolation.ts << 'EOF'
import { getDbAdapter } from "@/server/db";

async function testIsolation() {
  const adapter = getDbAdapter();

  // List artifacts for this tenant
  const artifacts = await adapter.listArtifacts();
  console.log(`Found ${artifacts.length} artifacts for tenant`);

  // Create a new work item
  const item = await adapter.createWorkItem({
    title: "Test Work Item",
    description: "Testing multi-tenant isolation",
  });
  console.log(`Created work item: ${item.id}`);

  // Verify tenant_id is set
  if (item.tenant_id !== process.env.NEON_TENANT_ID) {
    throw new Error("Tenant ID mismatch!");
  }

  console.log("✓ Multi-tenant isolation verified");
}

testIsolation().catch(console.error);
EOF

npx tsx test-isolation.ts
```

### 5.2 Health Check

Add a health check endpoint to verify database connectivity:

```typescript
// src/app/api/health/route.ts
import { getDbAdapter } from "@/server/db";

export async function GET() {
  const adapter = getDbAdapter();
  const isHealthy = await adapter.health();

  if (!isHealthy) {
    return Response.json({ status: "unhealthy", database: "postgres" }, { status: 503 });
  }

  return Response.json({ status: "ok", database: "postgres" });
}
```

Test it:

```bash
curl http://localhost:3000/api/health
```

### 5.3 Run Existing Tests

Update existing tests to work with Neon:

```bash
# Create test fixtures
npm test -- --testPathPattern=adapter

# Note: Tests that access JSON files will need to be updated to use the Neon adapter
```

---

## Step 6: Cleanup & Next Steps

### 6.1 Backup Original JSON Data

Keep the `.developer-agentic-os/` directory as a backup (don't delete yet):

```bash
cp -r .developer-agentic-os .developer-agentic-os.backup
```

### 6.2 Optional: Remove JSON Store

Once verified that Neon is working correctly, you can safely remove the JSON file adapters:

```bash
rm src/server/local-store/json-file.ts
rm src/server/local-store/artifact-store.ts
rm src/server/local-store/work-item-store.ts
# ... etc for other stores
```

### 6.3 Update Documentation

Update relevant docs to reflect the migration:

- [ ] README: Update setup instructions to mention Neon
- [ ] CONTEXT.md: Update "Local Store" definition to reflect Neon
- [ ] Contributing guide: Document how to use the Neon adapter

### 6.4 Deploy to Production

When ready to deploy to production:

1. **Set DATABASE_URL** on Vercel environment variables
2. **Set NEON_TENANT_ID** for production tenant (create new tenant for prod if needed)
3. **Run migrations** in production database
4. **Verify** health check passes on deployed app
5. **Monitor** database logs for errors

---

## Troubleshooting

### Connection Refused

**Error**: `connect ECONNREFUSED 127.0.0.1:5432`

**Cause**: DATABASE_URL is pointing to local PostgreSQL instead of Neon

**Fix**:

```bash
echo $DATABASE_URL
# Should be: postgresql://user:password@project.neon.tech/dbname
```

### Schema Not Found

**Error**: `relation "artifacts" does not exist`

**Cause**: Migration SQL wasn't run

**Fix**:

```bash
psql $DATABASE_URL < migrations/001-init.sql
```

### Tenant ID Mismatch

**Error**: `Tenant ID mismatch in multi-tenant query`

**Cause**: Using wrong tenant ID in application

**Fix**:

```bash
# Verify tenant ID matches migration output
echo $NEON_TENANT_ID
# Should match the UUID printed by migrate-to-neon.ts
```

### Too Many Connections

**Error**: `remaining connection slots are reserved`

**Cause**: Connection pool exhausted

**Fix**: Check that adapter connections are being released properly. Review connection pool configuration in `NeonAdapter`.

---

## Neon Adapter API Reference

### Constructor

```typescript
const adapter = new NeonAdapter({
  databaseUrl: process.env.DATABASE_URL,
  tenantId: process.env.NEON_TENANT_ID,
});
```

### Artifacts

```typescript
await adapter.listArtifacts(); // → Artifact[]
await adapter.getArtifact(id); // → Artifact | null
await adapter.createArtifact(data); // → Artifact
await adapter.updateArtifact(id, data); // → Artifact | null
await adapter.deleteArtifact(id); // → boolean
```

### Work Items

```typescript
await adapter.listWorkItems(); // → WorkItem[]
await adapter.getWorkItem(id); // → WorkItem | null
await adapter.createWorkItem(data); // → WorkItem
await adapter.updateWorkItem(id, data); // → WorkItem | null
await adapter.deleteWorkItem(id); // → boolean
```

### Skills

```typescript
await adapter.listSkills(); // → Skill[]
await adapter.getSkill(command); // → Skill | null
await adapter.createSkill(data); // → Skill
```

### Routines

```typescript
await adapter.listRoutines(); // → Routine[]
await adapter.getRoutine(name); // → Routine | null
await adapter.createRoutine(data); // → Routine
```

### Repos

```typescript
await adapter.listRepos(); // → Repo[]
await adapter.getRepo(owner, repo); // → Repo | null
await adapter.createRepo(data); // → Repo
```

### Signals

```typescript
await adapter.listSignals(); // → Signal[]
await adapter.createSignal(data); // → Signal
```

### Utility

```typescript
await adapter.health(); // → boolean
await adapter.close(); // Close connection pool
```

---

## Performance Considerations

### Indexes

All queries use indexed columns for performance:

- `tenant_id`: Primary filter on every table
- `created_at`: Sorting and time-range queries
- Composite indexes: `(tenant_id, status)`, `(tenant_id, command)`, etc.

### Connection Pooling

The Neon adapter uses a connection pool (via `pg.Pool`) to efficiently manage connections. Default pool size is handled by the `pg` library.

### Query Optimization

- Use `.listXxx()` for bulk reads (indexed by tenant_id)
- Use `.getXxx()` for single-item lookups (indexed)
- Pagination is deferred; implement server-side pagination in API routes if needed

---

## Related Documentation

- [ADR 0001: Multi-Tenancy Schema Pattern](../docs/adr/0001-multi-tenancy-schema-pattern.md)
- [NEON-SCHEMA.md](../docs/NEON-SCHEMA.md) — Complete schema reference
- [Neon Documentation](https://neon.tech/docs/)
- [node-postgres Documentation](https://node-postgres.com/)
