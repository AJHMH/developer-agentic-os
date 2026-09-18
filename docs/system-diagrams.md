# Developer Workflow OS v2 — System Diagrams

## Overview

This document describes four key diagrams for the Developer Workflow OS v2 architecture and workflows. The JSON specifications are in the `diagrams/` folder.

---

## 1. Architecture Diagram

**File**: `diagrams/architecture.json`

**Purpose**: Shows the hosted system components and their relationships.

**Key Components**:

- **Clerk** (Security): Authentication, organization identity, org membership management
- **Next.js Frontend** (Frontend): Hosted Command Centre, micro apps, UI rendering
- **Next.js API Routes** (Backend): Tenant-scoped API layer, webhook handlers
- **Neon Postgres** (Database): Multi-tenant row-level isolation, org state persistence
- **GitHub** (External): Repos, Actions, OIDC tokens

**Key Flows**:

- Frontend → Clerk: Session verification
- Frontend → API: API calls with tenant scope
- API → Clerk: Retrieve tenant context and org role
- API → Neon: All queries scoped to `WHERE tenant_id = ?`
- API ↔ GitHub: Repos, members, and Actions OIDC token verification

**Tenant Isolation**: The architecture enforces row-level multi-tenancy through:

- Clerk session provides `tenant_id`
- All Neon queries include `WHERE tenant_id = ?`
- Unique constraints use `(tenant_id, entity_key)` tuples
- Webhook events include tenant routing metadata

---

## 2. Workflow Diagram

**File**: `diagrams/workflow.json`

**Purpose**: Illustrates the core developer workflow loop through the Command Centre.

**Main Path**:

1. **Open Command Centre** (start)
2. **View Workspace State**: See artifacts and graph state
3. **Trigger Skill**: Select an AI skill, set model/effort level, provide input
4. **Skill Executes**: AI processing with optional tool calls
5. **Save Artifact**: Persist output as a plan, note, brief, or generated code
6. **Review & Update**: Inspect, edit, and refine in the graph

**Branch Points**:

- From View Workspace State: Trigger a skill to start processing
- Review → View Workspace: Graph updates loop back to the main view

**Key Concepts**:

- **Artifact**: Durable output persisted to workspace state
- **Graph**: The Second Brain visualization of connected work, tools, and signals

---

## 3. Sequence Diagram

**File**: `diagrams/sequence.json`

**Purpose**: Shows a typical request lifecycle when loading the workspace.

**Participants**:

- User Browser
- Next.js App
- Clerk (auth service)
- Neon DB

**Message Flow**:

1. User Browser → Next.js: `Load workspace`
2. Next.js → Clerk: `Verify session`
3. Clerk → Next.js: Returns `tenant_id`
4. Next.js → Neon: Query tenant-scoped hosted records
5. Neon → Next.js: Returns workspace and domain records
6. Next.js → User Browser: `Render workspace + graph`

**Tenant Safety**:

- Every database query includes the tenant filter
- Clerk provides the authoritative tenant context

---

## 4. Dataflow Diagram

**File**: `diagrams/dataflow.json`

**Purpose**: Traces how external data and hosted state flow through cache-backed UI rendering.

**Data Sources** (External):

- **GitHub**: Repository and Actions data fetched via API polling
- **Vercel API**: Projects, deployments, domains

**Pipeline**:

1. **GitHub Polling**: Repository and Actions data is fetched through API calls
   - GitHub → Cache: Polled records

2. **Webhook Ingress**: Receives deployment events
   - Vercel API → Webhook: Deployment webhooks

3. **Cache & Normalize**: Enriches and tenant-scopes the data
   - Webhook → Cache: Enrich & tenant-scope

4. **Command Centre UI**: Fetches and displays cached state
   - Cache → Command Centre: Fetch for display

5. **Skill Output**: Generates new artifacts
   - Command Centre → Cache: Save artifact

**Tenant Context**:

- All external data is enriched with `tenant_id` at ingress
- Database persistence maintains tenant scoping
- UI display is filtered to the authenticated org's data

---

## Implementation Status

### Implemented (ADR 0001 & 0002)

- ✅ Row-level multi-tenancy via `tenant_id` column
- ✅ Clerk organization → tenant mapping
- ✅ API layer tenant filtering
- ✅ GitHub OAuth integration and Vercel token-based API integration
- ✅ Webhook routing by tenant
- ✅ Auth middleware with `clerkMiddleware` in `src/proxy.ts`
- ✅ Hosted Command Centre UI

### In Development

- 🔄 Per-tenant GitHub org setting
- 🔄 GitHub repos list in UI
- 🔄 Deployment status display

### Schema Notes

- Hosted workspace/domain state is persisted in tenant-scoped `hosted_*` tables.
- Migration `004-hosted-state-normalization.sql` backfills legacy JSONB state tenant-by-tenant, records migration status, and only drops the retired blob tables after every tenant succeeds.
- `NeonHostedStateProvider` is the active hosted persistence path.

---

## Navigation

- **Architecture**: Start here to understand system components and their relationships
- **Workflow**: Reference when designing new features or user flows
- **Sequence**: Use for debugging API interactions and tenant context flow
- **Dataflow**: Understand how external data integrates into the workspace

## References

- [ADR 0001: Multi-Tenancy Schema Pattern](adr/0001-multi-tenancy-schema-pattern.md)
- [ADR 0002: Clerk/GitHub Org Integration](adr/0002-clerk-github-org-integration.md)
- [Context](../CONTEXT.md)
