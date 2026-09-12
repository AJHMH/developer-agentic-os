# ADR 0003: Per-Tenant Vercel Deployments

**Status**: Accepted, Partially Implemented

**Date**: 2026-09-09
**Last Updated**: 2026-09-12

## Status Update

The tenant-scoped deployment mapping is the accepted hosted architecture, but the complete mapping and deployment-resolution flow is not yet implemented.

The canonical tenant boundary is the Clerk organization. Repository registrations and deployment resources belong to that tenant. The Vercel project association is treated as an org-level resource rather than a shared global deployment target.

The current hosted implementation provides tenant-scoped persistence, explicit GitHub organization configuration, and GitHub organization membership checks. It does not yet provide durable Vercel project mappings, repository-to-tenant deployment resolution, GitHub Actions OIDC verification, or mapping-management APIs.

The normalized table definitions and endpoint examples below describe the accepted target design, not a claim that those interfaces are live today.

## Context

Each tenant (Clerk org) in Developer Agentic OS should have its own Vercel project and deployment domain. This allows:

- Isolated CI/CD pipelines per tenant
- Custom domain assignment per org
- Independent scaling and monitoring

E.g., Acme Corp's repos deploy to `acme.vercel.app`, Stripe's repos deploy to `stripe.vercel.app`.

**Challenge**: Today, the app is single-codebase (monorepo style). We need to route CI/CD to the correct Vercel project based on which org owns the GitHub repo being deployed.

## Decision

We will maintain a **Clerk org ↔ Vercel project mapping** and route GitHub Actions deployments accordingly:

### Tenant-Vercel Mapping Table

```sql
CREATE TABLE vercel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  domain VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id),
  INDEX idx_tenant_vercel (tenant_id)
);
```

### Deployment Flow

1. **GitHub repo is added to an org** (e.g., acme-corp on GitHub owned by Acme Clerk org)
   - We record: `repos` table has `tenant_id`, `github_repo_name`

2. **Developer pushes to main branch**
   - GitHub Actions workflow triggers

3. **GitHub Actions queries our backend**: "Which Vercel project owns `acme-corp/repo-name`?"
   - Query returns: `vercel_projects.vercel_project_id` for that tenant

4. **GitHub Actions calls Vercel API** with the correct `VERCEL_PROJECT_ID`
   - Deploy target is now tenant-scoped

5. **Vercel deployment completes**
   - Webhook fires to our app with tenant routing info (see ADR 0004)

### Database Schema

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  github_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, github_owner, github_repo),
  INDEX idx_tenant_repos (tenant_id)
);
```

## Implementation Approach

### Deployment identity and authorization

Repository registration is explicit and requires a Clerk organization administrator. The registered GitHub owner and repository are verified against the tenant's configured GitHub organization; ownership is not inferred only from request headers, repository names, or Vercel metadata.

Deployment resolution must verify a GitHub Actions OIDC identity with a restricted audience and claims matching the registered GitHub owner and repository, configured deployment workflow, protected deployment ref such as `main`, and tenant association.

The resolver returns only the primary Vercel project and optional team identifiers for that exact registered repository. A missing mapping returns an explicit `deployment_unconfigured` failure and never falls back to a shared or implicit project.

### Mapping lifecycle

Each tenant has one primary Vercel project for this ADR. A dedicated tenant-scoped persistence boundary stores the project and optional team identifiers. Tenant administrators may create or update the mapping; deletion leaves repository registrations intact but marks deployment configuration as unconfigured. Mapping changes affect future deployments, preserve historical deployment targets, and emit an audit event.

No long-lived fallback credential is supported by the current implementation. GitHub Actions OIDC is required for deployment resolution; any future migration fallback must first add encryption, tenant scoping, rotation, audit events, and an explicit removal deadline.

### GitHub Actions Workflow (in the tenant's repo)

The workflow is **generic** (one per tenant, or one shared across all tenants) but parameterized:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # Query our backend with the workflow's GitHub Actions OIDC identity
      - name: Resolve Vercel project
        id: resolve
        run: |
          PROJECT_ID=$(curl -s "https://app.vercel.app/api/repos/vercel-project" \
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN" \
            -H "X-GitHub-Owner: ${{ github.repository_owner }}" \
            -H "X-GitHub-Repo: ${{ github.event.repository.name }}" \
            | jq -r '.vercel_project_id')
          echo "PROJECT_ID=$PROJECT_ID" >> $GITHUB_OUTPUT

      # Deploy to the tenant's Vercel project
      - name: Deploy
        run: |
          npx vercel deploy \
            --project-id ${{ steps.resolve.outputs.PROJECT_ID }} \
            --token ${{ secrets.VERCEL_TOKEN }}
```

### Backend API: `/api/repos/vercel-project`

```typescript
// GET /api/repos/vercel-project
export async function GET(req: Request) {
  const githubOwner = req.headers.get("X-GitHub-Owner");
  const githubRepo = req.headers.get("X-GitHub-Repo");
  const token = req.headers.get("Authorization")?.split(" ")[1];

  // Verify token is a GitHub Actions token (not user-facing)
  // Could also use HMAC signature verification

  // Find the repo and its tenant
  const repo = await db.repos.findUnique({
    where: { github_owner_github_repo: { github_owner, github_repo } },
  });

  if (!repo) {
    return new Response(JSON.stringify({ error: "Repo not found" }), { status: 404 });
  }

  // Find the Vercel project for this tenant
  const vercelProject = await db.vercel_projects.findUnique({
    where: { tenant_id: repo.tenant_id },
  });

  return new Response(
    JSON.stringify({
      vercel_project_id: vercelProject?.vercel_project_id,
      vercel_team_id: vercelProject?.vercel_team_id,
    })
  );
}
```

## Alternative: Monorepo with Deployment Routing

If the Developer Agentic OS application itself is a single monorepo deployed once per tenant:

- Each tenant gets a separate Vercel project in their own Vercel team
- The deployment workflow reads the Clerk org ID from git metadata or environment
- GitHub Actions deploys the entire codebase to that org's Vercel project
- Multitenancy is handled at the Next.js route layer (see ADR 0001)

_This is simpler initially but limits per-org customization later._

## Risks & Mitigations

| Risk                                                      | Mitigation                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Repo added but Vercel project not created → deploy fails  | Create Vercel project during repo registration; use sensible defaults |
| Vercel project ID wrong or outdated                       | Validate on each deploy; alert on API errors                          |
| GitHub Actions token is compromised → bad actor redeploys | Use org-scoped tokens; rotate regularly; audit logs                   |

## Implementation Gaps

The following work remains before this decision can be marked fully implemented:

1. Add durable tenant-scoped persistence for the primary Vercel project mapping and enforce its uniqueness constraints.
2. Add admin-only APIs and UI for creating, replacing, and removing a tenant mapping.
3. Complete explicit repository registration and exact repository-to-tenant resolution in the live hosted path.
4. Implement GitHub Actions OIDC verification, including audience, repository, workflow, ref, and tenant checks.
5. Add deployment-resolution audit events and historical preservation when mappings change.
6. Define and execute the migration path for temporary fallback credentials, including their removal deadline.
7. Update the deployment workflow and resolver contract to return explicit `deployment_unconfigured` failures.

Until these gaps are closed, this ADR remains **Accepted, Partially Implemented**.

## Related Decisions

- **ADR 0001**: Multi-tenancy schema with tenant_id
- **ADR 0002**: Clerk org + GitHub org identity
- **ADR 0004**: Vercel webhook routing to tenants

## Current Status and Deferred Extensions

1. Custom Vercel settings remain a later UI concern.
   - The current implementation uses a default tenant-scoped project mapping with minimal configuration.

2. Multi-project repo targeting is still out of scope.
   - The model assumes one primary Vercel target per tenant unless a new requirement adds staging/prod split logic.

## References

- Vercel API: https://vercel.com/docs/api
- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- GitHub Actions: https://docs.github.com/en/actions
