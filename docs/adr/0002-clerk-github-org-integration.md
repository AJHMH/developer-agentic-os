# ADR 0002: Clerk + GitHub Org Integration for Multi-Tenant Identity

**Status**: Accepted and Implemented

**Date**: 2026-09-09
**Last Updated**: 2026-09-12

## Status Update

This identity model is now in effect. Clerk organization membership provides app-level access; GitHub org membership is verified separately through the GitHub OAuth token flow in `src/server/hosted-auth/github-link.ts`, and the system uses the tenant mapping created in `migrations/001-init.sql` to keep org membership and repository data scoped to the correct tenant.

The app has moved from an abstract pattern to an enforced tenant model: users must be invited to the Clerk org and verified as members of the GitHub org before they can access GitHub-backed repository data.

## Context

Developer Agentic OS is moving to multi-tenant mode with per-organization deployments. Two identity systems must work together:

1. **Clerk**: Manages app authentication (sign-in, org membership, invite flow)
2. **GitHub**: Provides source-of-truth org membership and repo access entitlements

The system must cleanly separate:

- **App access** (who can sign into the app?) → Clerk
- **Repository entitlements** (which repos can this dev access?) → GitHub

## Decision

We will use a **two-layer identity model**:

### Layer 1: Clerk Org as the App Tenant

- Each Clerk org corresponds to one app tenant (organizations table, tenant_id in Neon)
- Developers are invited to a Clerk org via **email invite link** (not auto-synced from GitHub)
- Clerk manages app-level permissions: who can access this org's dashboard

### Layer 2: GitHub Org for Repository Entitlements

- A separate GitHub org (e.g., `acme-corp` on GitHub) owns repositories
- Developers must be members of the GitHub org to see and work with its repos
- On each app session, we verify GitHub org membership when fetching GitHub data

### The Invite Flow

```
1. Admin creates a Clerk org in the app
2. Admin invites dev via email (Clerk generates invite link)
3. Dev accepts invite, joins the Clerk org
4. Dev links their GitHub account (via GitHub OAuth)
5. We verify dev is a member of the GitHub org
6. Dev gains access to repos from that GitHub org
```

### User-to-Org Mapping

```sql
CREATE TABLE clerk_org_members (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  clerk_user_id VARCHAR(255) NOT NULL,
  clerk_org_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  github_username VARCHAR(255),
  github_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, clerk_user_id),
  INDEX idx_tenant_members (tenant_id)
);
```

## Why This Pattern

### Separate App Access from Repo Entitlements

**Scenario 1**: Acme hires a contractor for 2 weeks. Admin invites them to Clerk org. Contractor accepts. But they're not a member of the Acme GitHub org (yet), so when they try to view issues, we surface a helpful message: _"You're not a member of the Acme GitHub org yet. Ask your admin to add you there."_

**Scenario 2**: Alice is a member of both Acme and Stripe GitHub orgs. She's invited to the Acme app, and separately to the Stripe app. Each appears as a separate Clerk org with separate dashboards.

### Single GitHub OAuth App (Multiple Tenants)

We create one shared GitHub OAuth app (registered once for all tenants). When a developer signs in:

1. Clerk handles user identity (who are you?)
2. GitHub OAuth enriches it (link your GitHub account)
3. We check GitHub org membership on each API request that needs it
4. Repo data is scoped to orgs the dev is actually a member of

This avoids per-tenant GitHub app registration (operational complexity).

### Invite via Email, Not GitHub Sync

Email invites are explicit and human-driven:

- Admin controls who gets app access
- Dev must actively accept the invite
- Clear audit trail

GitHub org sync could happen later if needed (automated provisioning), but manual invite is correct for first-build.

## Implementation Notes

### Clerk Configuration

```typescript
// Clerk org structure
{
  "id": "org_abc123",
  "name": "Acme Corp",
  "slug": "acme-corp"
}

// Members joined via invite
// Clerk handles the email + accept flow
```

### GitHub Verification

```typescript
// On each API request that needs GitHub data:
async function requireGitHubOrgMembership(req, orgHandle: string) {
  const user = auth.currentUser(); // Clerk
  const githubToken = await getGitHubToken(user.id); // GitHub OAuth token

  const isMember = await github.checkOrgMembership(githubToken, orgHandle, user.githubUsername);

  if (!isMember) {
    throw new Error(`Not a member of ${orgHandle} on GitHub`);
  }
}
```

### Tenant Registration

When a Clerk org is created in the app:

```typescript
async function registerClerkOrg(clerkOrgId: string) {
  const clerkOrg = await clerk.orgs.retrieve(clerkOrgId);

  // Create app tenant
  const tenant = await db.organizations.create({
    name: clerkOrg.name,
    clerk_org_id: clerkOrgId,
  });

  return tenant.id;
}
```

## Risks & Mitigations

| Risk                                                    | Mitigation                                              |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Dev invited to Clerk org but not GitHub org → confusion | Surface helpful message + link to invite flow           |
| GitHub org membership check is slow                     | Cache membership state + refresh on session start       |
| GitHub OAuth token expires                              | Use refresh tokens; handle 401s gracefully              |
| Contractor joins Clerk org but shouldn't see prod repos | Enforce GitHub membership + explicit repo configuration |

## Related Decisions

- **ADR 0001**: Row-level tenant_id in Neon
- **ADR 0003**: Per-tenant Vercel projects — each Clerk org gets one Vercel project
- **ADR 0004**: Webhook routing — events tagged with Clerk org context

## Current Status and Deferred Extensions

1. GitHub org sync is intentionally still manual for now.
   - We continue to prefer the explicit Clerk invite flow rather than auto-provisioning access from GitHub membership.
2. GitHub team-based access constraints remain a future extension if a tenant requires narrower repo permissions than org-level membership.
3. GitHub org rename handling remains a deferred operational concern; the current implementation assumes a stable configured org name.

## References

- Clerk Org documentation: https://clerk.com/docs/organizations/overview
- GitHub OAuth: https://docs.github.com/en/developers/apps/building-oauth-apps
- GitHub Org API: https://docs.github.com/en/rest/orgs
