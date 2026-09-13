# ADR 0001: Multi-Tenancy Schema Pattern

**Status**: Accepted and Partially Implemented; canonical hosted provider selected

**Date**: 2026-09-09
**Last Updated**: 2026-09-12

## Status Update

The live hosted product uses the tenant-scoped hosted provider as the canonical Hosted State persistence contract. Its state, workspace, deployment, and webhook tables are keyed by `tenant_id`; the contract is versioned and recorded in Neon during provider initialization.

The normalized tables in `migrations/001-init.sql` are legacy migration inputs until an explicit transformation removes them. The migration command fails closed when those tables are present rather than silently dropping their data. They are not a second production read/write path. The application treats each Clerk organization as a Tenant, and all hosted reads/writes are constrained to the authenticated organization's `tenant_id`.

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

1. **Every canonical tenant-owned hosted table has a non-null `tenant_id` column** (indexed, part of unique constraints where needed). Platform-level audit rows for unknown or malformed requests are the documented exception and carry no Tenant.
2. **All canonical hosted queries must include `WHERE tenant_id = ?`** in the query layer or provider boundary
3. **The Clerk session provides the authenticated tenant context** on each request
4. **The Next.js API layer enforces tenant filtering** before any data is returned

### Schema Principles

- `tenant_id` is a UUID foreign key to an `organizations` table
- Unique constraints on entities include `(tenant_id, entity_key)` tuples, not just `entity_key`
- Example: artifacts uniquely identified by `(tenant_id, artifact_id)`, not just `artifact_id`
- GitHub and Vercel data is cached but includes `tenant_id` to track which org synced it
- Webhook events include tenant routing metadata to look up the org before processing

## Why Row-Level Over Alternatives

| Pattern              | Pros                                                         | Cons                                                                |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Row-level**        | Single schema, dynamic scaling, fast migrations, audit trail | Requires query discipline, risk of filter bypass                    |
| **Table-per-tenant** | Trivial isolation, no filter risk                            | Schema explosion, hard to query across tenants, migration nightmare |
| **DB-per-tenant**    | Strongest isolation                                          | Operational overhead, cost, complexity, migrations per tenant       |

Row-level is the SaaS standard for good reasons: it scales, it's maintainable, and it leverages database constraints properly.

## Implementation Notes

### Enforcement Strategy

1. **Database Layer**: Canonical hosted tables require `tenant_id` and composite tenant keys where state is keyed by `state_key`
2. **Provider Layer**: Hosted persistence methods bind every read/write to the provider's Tenant identity
3. **API Layer**: Next.js route handlers read `tenant_id` from Clerk session and pass it to hosted data access
4. **Testing**: Every hosted test seeds a test Tenant and verifies cross-Tenant isolation at the public provider or route seam

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
3. Tenant-scoped audit logging is implemented for hosted workflows. Platform-level audit logging for unknown or malformed requests remains separate from Tenant audit data.

## References

- [Designing Multi-Tenant SaaS with PostgreSQL](https://www.cockroachlabs.com/blog/multi-tenant-database-design/)
- Clerk Org model: https://clerk.com/docs/organizations/overview
- Neon PostgreSQL: https://neon.tech/
