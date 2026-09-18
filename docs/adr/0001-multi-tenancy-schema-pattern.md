# ADR 0001: Multi-Tenancy Schema Pattern

**Status**: Accepted and Implemented

**Date**: 2026-09-09
**Last Updated**: 2026-09-12

## Status Update

This pattern is now implemented in the hosted product. The canonical migrations are `migrations/001-init.sql`, `migrations/003-hosted-deployment-normalization.sql`, and `migrations/004-hosted-state-normalization.sql`; the hosted runtime reads and writes only canonical tenant-scoped tables, and the older JSONB blob tables are migration inputs only.

The application now treats each Clerk organization as a tenant, constrains hosted reads/writes to the authenticated org's `tenant_id`, and fails closed if the Clerk org has not been provisioned into `organizations`.

## Context

Developer Agentic OS v2 is transitioning from local-first single-tenant (JSON files in `.developer-agentic-os/`) to a multi-tenant SaaS model on Vercel + Neon.

Key constraints:

- Multiple organizations (tenants) run independently on shared infrastructure
- Each organization has its own repository context, artifacts, work items, skills, and routines
- Row-level data isolation is required (not table-per-tenant, not separate databases)
- Neon is the single source of truth for persistent state
- The application must enforce tenant context on every data access

## Decision

We will use **row-level tenant ID isolation** as the multi-tenancy pattern:

1. **Tenant-owned tables include a `tenant_id` column** (not null, indexed, part of unique constraints where needed)
2. **All queries against tenant-owned tables must include `WHERE tenant_id = ?`** in the ORM/query layer or middleware
3. **The Clerk session provides the authenticated tenant context** on each request
4. **The Next.js API layer enforces tenant filtering** before any data is returned
5. **A small set of global reference tables, such as `schema_migrations`, remain intentionally outside the tenant scope**

### Schema Principles

- `tenant_id` is a UUID foreign key to an `organizations` table on tenant-owned tables
- Unique constraints on tenant-scoped entities include `(tenant_id, entity_key)` tuples, not just `entity_key`
- Example: artifacts uniquely identified by `(tenant_id, artifact_id)`, not just `artifact_id`
- GitHub and Vercel data is cached but includes `tenant_id` to track which org synced it
- Webhook events include tenant routing metadata to look up the org before processing
- Global user identity and migration metadata are not replicated per tenant; they are referenced from tenant-owned rows via foreign keys or app-level membership tables

## Why Row-Level Over Alternatives

| Pattern              | Pros                                                         | Cons                                                                |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Row-level**        | Single schema, dynamic scaling, fast migrations, audit trail | Requires query discipline, risk of filter bypass                    |
| **Table-per-tenant** | Trivial isolation, no filter risk                            | Schema explosion, hard to query across tenants, migration nightmare |
| **DB-per-tenant**    | Strongest isolation                                          | Operational overhead, cost, complexity, migrations per tenant       |

Row-level is the SaaS standard for good reasons: it scales, it's maintainable, and it leverages database constraints properly.

## Implementation Notes

### Enforcement Strategy

1. **Database Layer**: Foreign key constraints ensure `tenant_id` references a valid org for tenant-owned rows
2. **Persistence Layer**: hosted query methods read the Clerk org, resolve it through `organizations`, and scope writes/reads to the resulting UUID; missing org mappings fail closed instead of being auto-created at runtime
3. **API Layer**: Next.js route handlers read `tenant_id` from the active Clerk organization, pass it to hosted stores, and reject cross-tenant access attempts
4. **Testing**: tenant-scoped migrations and hosted persistence are covered by focused regression tests

This is still row-level isolation, not table-per-tenant. The system shares a single schema while keeping data access constrained to the authenticated organization's `tenant_id` across tenant-owned tables.

### Example Table Structure

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  clerk_org_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  INDEX idx_tenant_artifacts (tenant_id)
);

CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  INDEX idx_tenant_work_items (tenant_id)
);
```

## Risks & Mitigations

| Risk                                                  | Mitigation                                                |
| ----------------------------------------------------- | --------------------------------------------------------- |
| Developer forgets to filter by `tenant_id` in a query | Use ORM middleware + peer review + SQL linting            |
| Accidental cross-tenant data leak                     | Automated tests with multi-tenant fixtures; audit logging |
| Performance: filtering adds latency                   | Index `tenant_id` on all tables; use composite keys       |
| Schema migration complexity                           | Migrations are standard; no per-tenant overhead           |

## Related Decisions

- **ADR 0002**: Clerk + GitHub org membership → `tenant_id` assignment
- **ADR 0003**: Per-tenant Vercel deployments → `tenant_id` maps to a Vercel project ID
- **ADR 0004**: Webhook routing → webhook events routed to correct `tenant_id`

## Current Status and Resolved Questions

1. GitHub data is cached in Neon with `tenant_id` and GitHub remains the source of truth for repo content.
   - This is the implemented pattern used for repos, issues, pull requests, and related metadata.
2. Cross-tenant relationships remain disallowed.
   - Each org is isolated by `tenant_id`; the system is designed to reject access outside the current tenant.
3. Audit logging is still a future enhancement if compliance requirements or security review demand it.

## References

- [Designing Multi-Tenant SaaS with PostgreSQL](https://www.cockroachlabs.com/blog/multi-tenant-database-design/)
- Clerk Org model: https://clerk.com/docs/organizations/overview
- Neon PostgreSQL: https://neon.tech/
