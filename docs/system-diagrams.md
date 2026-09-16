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
- **GitHub** (External): Repos, Actions, OIDC tokens, webhooks
- **Vercel** (Cloud): Deployments, preview URLs, deployment status
- **Vercel Hosting** (Cloud): Edge Functions, Functions, app hosting

**Key Flows**:
- Frontend → Clerk: Session verification
- Frontend → API: API calls with tenant scope
- API → Clerk: Retrieve tenant context and org role
- API → Neon: All queries scoped to `WHERE tenant_id = ?`
- API ↔ GitHub: Repos, members, Actions OIDC token verification
- API ↔ Vercel: Deployment queries and webhook handling
- GitHub/Vercel → API: Webhooks for push, PR, Actions, deployments
- Vercel Hosting → Neon: Persisted state
- Vercel Hosting → Frontend: Serves the application

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
2. **View Workspace State**: See artifacts, work items, routines, and the Second Brain graph
3. **Trigger Skill**: Select an AI skill, set model/effort level, provide input
4. **Skill Executes**: AI processing with optional tool calls
5. **Save Artifact**: Persist output as a plan, note, brief, or generated code
6. **Review & Update**: Inspect, edit, refine in the graph
7. **Create/Trigger Routine**: Manual or schedule-aware execution of workflows
8. **Routine Processes**: Sequential skill calls and tool invocations
9. **Sync External Context**: Fetch GitHub repos and Vercel deployments
10. **Done** (end)

**Branch Points**:
- From View Workspace State: Either trigger a skill or sync external context
- Review → View Workspace: Graph updates loop back to the main view
- Routine Exec → Sync: Routines can trigger external context syncing

**Key Concepts**:
- **Artifact**: Durable output persisted to workspace state
- **Routine**: Scheduled or manual multi-step workflow with skill calls
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
- GitHub API

**Message Flow**:

1. User Browser → Next.js: `Load workspace`
2. Next.js → Clerk: `Verify session`
3. Clerk → Next.js: Returns `tenant_id, org role`
4. Next.js → Neon: `SELECT * WHERE tenant_id = ?`
5. Neon → Next.js: Returns artifacts, work items, routines
6. Next.js → GitHub: `GET /user/repos (cached)`
7. GitHub → Next.js: Returns repo list and permissions
8. Next.js → User Browser: `Render workspace + graph`

**Tenant Safety**:
- Every database query includes the tenant filter
- Clerk provides the authoritative tenant context
- GitHub data access is cached per tenant

---

## 4. Dataflow Diagram

**File**: `diagrams/dataflow.json`

**Purpose**: Traces how external data (GitHub repos, Actions, Vercel deployments) flows through the system to the workspace.

**Data Sources** (External):
- **GitHub Repos**: Source repos, branches, commits
- **GitHub Actions**: Workflows, runs, deployment status
- **Vercel API**: Projects, deployments, domains

**Pipeline**:

1. **Webhook Ingress**: Receives push, PR, and deployment events
   - GitHub repos → Webhook: Push webhooks
   - GitHub Actions → Webhook: Workflow completion events
   - Vercel API → Webhook: Deployment webhooks

2. **Cache & Normalize**: Enriches and tenant-scopes the data
   - Webhook → Cache: Enrich & tenant-scope

3. **Workspace State**: Persists to the Neon database
   - Cache → Workspace State: Persist to DB

4. **Signal Triage**: Processes events for user notification
   - Workspace State → Triage: Read events
   - Triage → Workspace State: Update status

5. **Command Centre UI**: Fetches and displays workspace data
   - Workspace State → Command Centre: Fetch for display

6. **Skill Output**: Generates new artifacts
   - Skill Output → Workspace State: Save artifact
   - Workspace State → Command Centre: Refresh graph

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
- ✅ GitHub and Vercel OAuth integration
- ✅ Webhook routing by tenant
- ✅ Auth middleware with `clerkMiddleware` in `src/proxy.ts`
- ✅ Hosted Command Centre UI

### In Development
- 🔄 Per-tenant GitHub org setting
- 🔄 GitHub repos list in UI
- 🔄 Deployment status display

### Schema Notes
- **Note**: `developer_agentic_os_workspace_state` is currently a single JSONB blob per tenant (not the normalized `organizations/artifacts/work_items` tables shown in migrations)
- The normalized schema exists in `migrations/001-init.sql` but is not actively used by the live hosted path
- `neon-adapter.ts` implementing the normalized schema is referenced only in docs and tests

---

## Navigation

- **Architecture**: Start here to understand system components and their relationships
- **Workflow**: Reference when designing new features or user flows
- **Sequence**: Use for debugging API interactions and tenant context flow
- **Dataflow**: Understand how external data integrates into the workspace

## References

- [ADR 0001: Multi-Tenancy Schema Pattern](../adr/0001-multi-tenancy-schema-pattern.md)
- [ADR 0002: Clerk/GitHub Org Integration](../adr/0002-clerk-github-org-integration.md)
- [Context](../CONTEXT.md)
