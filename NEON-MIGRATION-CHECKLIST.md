# Neon Migration Checklist

Use this checklist to track your progress through the Neon migration.

**Total Steps**: ~35 | **Status**: Ready to Begin

---

## Phase 1: Setup & Prerequisites

- [ ] **1.1** Create Neon account at https://neon.tech/
- [ ] **1.2** Create new Neon project
- [ ] **1.3** Save database credentials
- [ ] **1.4** Set `DATABASE_URL` environment variable
  ```bash
  export DATABASE_URL="postgresql://user:password@project.neon.tech/dbname"
  ```
- [ ] **1.5** Verify connection
  ```bash
  psql $DATABASE_URL -c "SELECT 1"
  ```
- [ ] **1.6** Install `pg` package
  ```bash
  npm install pg
  npm install --save-dev @types/pg
  ```

---

## Phase 2: Deploy Schema

- [ ] **2.1** Review migration SQL file
  ```bash
  cat migrations/001-init.sql | head -50
  ```
- [ ] **2.2** Run schema migration
  ```bash
  psql $DATABASE_URL < migrations/001-init.sql
  ```
- [ ] **2.3** Verify schema created (24 tables)
  ```bash
  psql $DATABASE_URL -c "
    SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public'
  "
  ```
- [ ] **2.4** Check indexes created
  ```bash
  psql $DATABASE_URL -c "
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename
  "
  ```
- [ ] **2.5** Verify foreign keys
  ```bash
  psql $DATABASE_URL -c "
    SELECT constraint_name, table_name, column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = 'public'
  "
  ```

---

## Phase 3: Migrate Existing Data

- [ ] **3.1** Back up existing JSON data
  ```bash
  cp -r .developer-agentic-os .developer-agentic-os.backup
  ```
- [ ] **3.2** Set test organization ID
  ```bash
  export CLERK_ORG_ID="test-org-001"
  ```
- [ ] **3.3** Run migration script
  ```bash
  npx tsx scripts/migrate-to-neon.ts
  ```
- [ ] **3.4** Note the tenant ID printed by migration
  ```bash
  # Example output:
  # All data migrated to tenant: abc123de-f456-7890-ghij-klmnopqrstuv
  ```
- [ ] **3.5** Save tenant ID as environment variable
  ```bash
  export NEON_TENANT_ID="abc123de-f456-7890-ghij-klmnopqrstuv"
  ```
- [ ] **3.6** Verify artifact count in Neon
  ```bash
  psql $DATABASE_URL -c "SELECT COUNT(*) FROM artifacts"
  ```
- [ ] **3.7** Verify work items count in Neon
  ```bash
  psql $DATABASE_URL -c "SELECT COUNT(*) FROM work_items"
  ```
- [ ] **3.8** Check tenant isolation (all data has same tenant_id)
  ```bash
  psql $DATABASE_URL -c "
    SELECT DISTINCT tenant_id FROM artifacts
  "
  ```

---

## Phase 4: Integrate Neon Adapter

- [ ] **4.1** Review Neon adapter implementation
  ```bash
  cat src/server/adapters/neon-adapter.ts | head -100
  ```
- [ ] **4.2** Create database module
  ```bash
  cat > src/server/db.ts << 'EOF'
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
  EOF
  ```
- [ ] **4.3** Update `.env.local` with required variables
  ```bash
  cat >> .env.local << 'EOF'
  DATABASE_URL=postgresql://...
  NEON_TENANT_ID=abc123de-...
  EOF
  ```
- [ ] **4.4** Identify API routes that need updating
  ```bash
  grep -r "readJsonFile\|writeJsonFile" src/app/api --include="*.ts" | wc -l
  ```
- [ ] **4.5** Update artifacts API route
  - [ ] Replace `readJsonFile` with `adapter.listArtifacts()`
  - [ ] Replace `writeJsonFile` with `adapter.createArtifact()`
  - [ ] Test GET `/api/artifacts`
  - [ ] Test POST `/api/artifacts`
- [ ] **4.6** Update work items API route
  - [ ] Replace file access with adapter calls
  - [ ] Test GET `/api/work-items`
  - [ ] Test POST `/api/work-items`
- [ ] **4.7** Update other API routes (skills, routines, repos, etc.)
  - [ ] List each API route file that needs updating
  - [ ] Update each one with adapter calls
  - [ ] Test each endpoint

---

## Phase 5: Validation & Testing

- [ ] **5.1** Create health check endpoint
  ```bash
  cat > src/app/api/health/route.ts << 'EOF'
  import { getDbAdapter } from "@/server/db";

  export async function GET() {
    const adapter = getDbAdapter();
    const isHealthy = await adapter.health();
    return Response.json({ status: isHealthy ? "ok" : "unhealthy" });
  }
  EOF
  ```
- [ ] **5.2** Test health check
  ```bash
  npm run dev &
  curl http://localhost:3000/api/health
  ```
- [ ] **5.3** Verify artifacts are returned
  ```bash
  curl http://localhost:3000/api/artifacts | jq '.artifacts | length'
  ```
- [ ] **5.4** Verify work items are returned
  ```bash
  curl http://localhost:3000/api/work-items | jq '.items | length'
  ```
- [ ] **5.5** Create integration test
  ```bash
  cat > tests/neon-integration.test.ts << 'EOF'
  import { seedTestData, cleanupTestData } from "./fixtures/neon-fixtures";
  import type { TestFixture } from "./fixtures/neon-fixtures";

  describe("Neon Integration", () => {
    let fixture: TestFixture;

    beforeAll(async () => {
      fixture = await seedTestData();
    });

    afterAll(async () => {
      await cleanupTestData(fixture.adapter, fixture.tenantId);
      await fixture.adapter.close();
    });

    test("should list artifacts for tenant", async () => {
      const artifacts = await fixture.adapter.listArtifacts();
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts.every(a => a.tenant_id === fixture.tenantId)).toBe(true);
    });

    test("should create and retrieve work item", async () => {
      const item = await fixture.adapter.createWorkItem({
        title: "Test Item",
        status: "open",
      });
      expect(item.tenant_id).toBe(fixture.tenantId);

      const retrieved = await fixture.adapter.getWorkItem(item.id as string);
      expect(retrieved?.title).toBe("Test Item");
    });
  });
  EOF
  ```
- [ ] **5.6** Run integration tests
  ```bash
  npm test -- tests/neon-integration.test.ts
  ```
- [ ] **5.7** Verify multi-tenant isolation with multiple adapters
  ```bash
  # Create a test script that:
  # 1. Creates two separate adapters with different tenant IDs
  # 2. Adds data to each
  # 3. Verifies each sees only its own data
  ```
- [ ] **5.8** Test error handling
  - [ ] Invalid tenant ID → should return empty results
  - [ ] Database offline → should throw connection error
  - [ ] Missing credentials → should throw configuration error

---

## Phase 6: Performance & Optimization

- [ ] **6.1** Run slow query analysis
  ```bash
  psql $DATABASE_URL -c "
    SELECT query, mean_time, max_time
    FROM pg_stat_statements
    ORDER BY mean_time DESC
    LIMIT 10
  "
  ```
- [ ] **6.2** Verify indexes are used
  ```bash
  # Add EXPLAIN ANALYZE to slow queries
  psql $DATABASE_URL -c "
    EXPLAIN ANALYZE
    SELECT * FROM artifacts WHERE tenant_id = '$NEON_TENANT_ID'
  "
  ```
- [ ] **6.3** Check connection pool usage
  - [ ] Monitor active connections in Neon console
  - [ ] Verify connections are released after requests
  - [ ] Check for connection leaks in application
- [ ] **6.4** Load test with multiple requests
  ```bash
  ab -n 100 -c 10 http://localhost:3000/api/artifacts
  ```

---

## Phase 7: Cleanup & Documentation

- [ ] **7.1** Update README
  - [ ] Add Neon setup instructions
  - [ ] Update environment variables section
  - [ ] Add link to NEON-MIGRATION-GUIDE.md
- [ ] **7.2** Update CONTEXT.md
  - [ ] Update "Local Store" definition to reference Neon
  - [ ] Update "Main App Runtime" to mention Neon for persistence
- [ ] **7.3** Create migration documentation
  - [ ] Review NEON-MIGRATION-GUIDE.md is accurate
  - [ ] Add any project-specific notes
  - [ ] Link from main README
- [ ] **7.4** Update contributing guide
  - [ ] Document how to use Neon adapter in development
  - [ ] Add section on writing data access code
  - [ ] Add examples of common adapter usage
- [ ] **7.5** Archive JSON files (optional)
  ```bash
  # Don't delete yet, keep as backup
  tar -czf .developer-agentic-os.backup.tar.gz .developer-agentic-os.backup/
  ```
- [ ] **7.6** Update tests
  - [ ] Review all tests that access JSON files
  - [ ] Update to use fixtures or mock adapter
  - [ ] Verify all tests pass
- [ ] **7.7** Create CHANGELOG entry
  ```markdown
  ## [Unreleased]

  ### Changed

  - Migrated data persistence from local JSON files to Neon PostgreSQL
  - All multi-tenant data now stored in Neon with row-level tenant_id isolation
  - Replaced json-file.ts adapter with NeonAdapter for all data access
  ```

---

## Phase 8: Production Deployment

- [ ] **8.1** Create production Neon project
  - [ ] Create separate Neon database for production
  - [ ] Save production database credentials
- [ ] **8.2** Set up production environment variables
  - [ ] Add `DATABASE_URL` to Vercel project settings
  - [ ] Add `NEON_TENANT_ID` for production organization
- [ ] **8.3** Run migrations in production
  ```bash
  psql $PRODUCTION_DATABASE_URL < migrations/001-init.sql
  ```
- [ ] **8.4** Create production tenant (or migrate existing)
  ```bash
  npx tsx scripts/migrate-to-neon.ts
  # Or set NEON_TENANT_ID to production org UUID
  ```
- [ ] **8.5** Test production health check
  ```bash
  curl https://app.vercel.app/api/health
  ```
- [ ] **8.6** Monitor production database
  - [ ] Set up Neon alerts for disk usage
  - [ ] Monitor connection count
  - [ ] Check slow queries
- [ ] **8.7** Enable backup strategy
  - [ ] Configure Neon automated backups
  - [ ] Test restore procedure
- [ ] **8.8** Document production runbooks
  - [ ] How to scale database
  - [ ] How to debug production issues
  - [ ] How to restore from backup

---

## Post-Migration

- [ ] **9.1** Remove old JSON files (after 1 week in production)
  ```bash
  rm -rf .developer-agentic-os
  rm -rf .developer-agentic-os.backup
  ```
- [ ] **9.2** Celebrate! 🎉
  - You've successfully migrated to a production-ready multi-tenant database!

---

## Troubleshooting

If you encounter issues, refer to [NEON-MIGRATION-GUIDE.md](NEON-MIGRATION-GUIDE.md#troubleshooting) for common problems and solutions.

**Key Resources**:

- [ADR 0001: Multi-Tenancy Schema Pattern](docs/adr/0001-multi-tenancy-schema-pattern.md)
- [Neon Schema Design](docs/NEON-SCHEMA.md)
- [Migration Guide](NEON-MIGRATION-GUIDE.md)
- [Neon Documentation](https://neon.tech/docs/)

---

## Summary

**Estimated Time**: 4-8 hours depending on number of API routes

**Key Milestones**:

1. ✅ Schema deployed to Neon
2. ✅ Existing data migrated
3. ✅ Neon adapter implemented
4. ✅ API routes updated
5. ✅ Tests passing
6. ✅ Documentation updated
7. ✅ Ready for production

**Next Phase**: [Clerk + GitHub OAuth Integration](docs/adr/0002-clerk-github-org-integration.md)
