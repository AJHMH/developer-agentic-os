# Neon Migration Checklist

Use this checklist for both new hosted installs and existing local-data migrations.

- [ ] Set `DATABASE_URL` for the target Neon database.
- [ ] Set `CLERK_ORG_ID` for the tenant being provisioned.
- [ ] Run `cd <repo-root> && DATABASE_URL=\"$DATABASE_URL\" CLERK_ORG_ID=\"$CLERK_ORG_ID\" npx tsx scripts/migrate-to-neon.ts` to apply `001-init.sql`, `003-hosted-deployment-normalization.sql`, and `004-hosted-state-normalization.sql`, provision the tenant, and import local data if present.
- [ ] Verify `organizations` contains exactly one row for `CLERK_ORG_ID`.
- [ ] Verify `schema_migrations` records canonical `.sql` versions only.
- [ ] Verify the hosted runtime tables exist: `hosted_workspaces`, `hosted_workspace_users`, `hosted_records`, `hosted_audit`.
- [ ] Verify the deployment tables exist: `repos`, `vercel_projects`, `vercel_project_history`, `vercel_webhook_events`.
- [ ] If local `.developer-agentic-os/` JSON files existed, verify the migrated tenant data is present in canonical tables.
- [ ] Start the hosted runtime only after the tenant is provisioned.
