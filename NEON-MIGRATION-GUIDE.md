# Neon Migration & Provisioning Guide

This repository supports one authoritative hosted provisioning path:

1. Run `scripts/migrate-to-neon.ts` with `DATABASE_URL` and the target `CLERK_ORG_ID`.
2. Verify the canonical tables and `organizations` mapping.
3. Start the hosted runtime only after the `organizations` row exists.

The hosted runtime no longer auto-provisions tenants or falls back to retired hosted tables.

## When to run this

- **Existing installation with local data**: the script provisions the tenant and imports `.developer-agentic-os/` JSON data if present.
- **New hosted installation**: the same script provisions the tenant even if there is no local JSON data to import.

## Required environment

```env
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>
CLERK_ORG_ID=org_123
```

Optional local import source:

- `.developer-agentic-os/artifacts.json`
- `.developer-agentic-os/work-items.json`
- `.developer-agentic-os/skills.json`
- `.developer-agentic-os/routines.json`
- `.developer-agentic-os/handoffs.json`
- `.developer-agentic-os/repos.json`

If those files are missing, provisioning still succeeds and only the tenant registration is created.

## Canonical steps

### 1. Provision the tenant and import local data if present

```bash
cd <repo-root>
DATABASE_URL="$DATABASE_URL" CLERK_ORG_ID="$CLERK_ORG_ID" npx tsx scripts/migrate-to-neon.ts
```

The script:

- ensures `001-init.sql`, `003-hosted-deployment-normalization.sql`, and `004-hosted-state-normalization.sql` are recorded as the canonical schema versions
- creates or reuses the `organizations` row for `CLERK_ORG_ID`
- imports any local JSON data into canonical tenant-scoped tables
- records migration status in `migration_status`

### 2. Verify the canonical tables

```bash
psql "$DATABASE_URL" -c "SELECT id, clerk_org_id FROM organizations WHERE clerk_org_id = '$CLERK_ORG_ID'"
psql "$DATABASE_URL" -c "SELECT version FROM schema_migrations ORDER BY version"
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('repos','vercel_projects','hosted_workspaces','hosted_records','hosted_workspace_users') ORDER BY table_name"
```

Expected results:

- one `organizations` row for the Clerk org
- canonical migration entries ending in `.sql`
- canonical hosted/deployment tables present

## Operational notes

- Hosted persistence and webhook writes fail closed if the Clerk org is not already present in `organizations`.
- The retired `developer_agentic_os_*` hosted tables are migration inputs only; `003` and `004` backfill from them and drop them.
- Do not configure the hosted runtime to depend on JSON fixture storage or a tenant UUID environment variable.

## Troubleshooting

### Missing organization mapping

If the hosted runtime reports that the Clerk org is not provisioned in `organizations`, rerun the canonical provisioning step:

```bash
DATABASE_URL="$DATABASE_URL" CLERK_ORG_ID="$CLERK_ORG_ID" npx tsx scripts/migrate-to-neon.ts
```

### Migration drift

If `schema_migrations` contains old bare version names such as `001-init`, rerun the same script. It normalizes legacy version aliases to the canonical `.sql` entries.

## Hosted Legacy-Table Recovery

Canonical hosted upgrades rely on `migrations/003-hosted-deployment-normalization.sql` and
`migrations/004-hosted-state-normalization.sql` to migrate legacy
`developer_agentic_os_*` rows tenant-by-tenant.

- Each tenant writes a `migration_status` row with its `source_model`,
  `target_model`, migration `version`, terminal `status`, `completed_at`, and
  `failure_details`.
- Retries are safe: deployment history and webhook audit rows have dedupe guards,
  and hosted records without legacy IDs derive deterministic `uuid_generate_v5`
  identifiers.
- Recovery is the default rollback path: if any tenant fails, the migration keeps
  the legacy source table in place instead of dropping it, so the operator can
  repair the bad tenant data or organization mapping and rerun the migration.

### Recovering a failed tenant upgrade

1. Inspect per-tenant status:

   ```sql
   SELECT tenant_id, source_model, target_model, version, status, completed_at, failure_details
   FROM migration_status
   WHERE version IN ('003-hosted-deployment-normalization', '004-hosted-state-normalization')
   ORDER BY completed_at NULLS FIRST, tenant_id, source_model;
   ```

2. Repair the failing tenant's legacy data or missing organization mapping.
3. Re-run the canonical migrations; completed tenants are safe to retry.
4. Confirm the failed tenant now reports `status = 'completed'`. Only then will
   the migration remove the corresponding `developer_agentic_os_*` source table.
