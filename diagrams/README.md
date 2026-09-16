# Developer Workflow OS v2 — Interactive Architecture Diagrams

## Overview

Four comprehensive interactive HTML diagrams visualizing the Developer Workflow OS v2 multi-tenant SaaS platform architecture:

1. **architecture.html** — System architecture with 5 core components and their tenant-scoped interactions
2. **sequence.html** — Workspace load API sequence demonstrating tenant context flow
3. **workflow.html** — Developer workflow loop through Command Centre (7 stages)
4. **dataflow.html** — External data ingestion pipeline (GitHub, Vercel → Signal Triage → UI)

All diagrams are:

- ✓ **Interactive**: Pan, zoom, dark/light theme toggle
- ✓ **Standalone HTML**: No dependencies, open in any browser
- ✓ **Exportable**: Download as SVG or PNG
- ✓ **Responsive**: Scale to any viewport
- ✓ **Embedded SVG**: Inline graphics for fast loading

---

## Diagram Details

### 1. Architecture (`architecture.html`)

**Purpose**: Core system topology with tenant isolation patterns

**Components**:

- **Next.js Frontend** (Command Centre) — User interface, tenant context management
- **Next.js API** (tenant-scoped) — All requests filtered by `tenant_id`
- **Neon Postgres** (row-level isolation) — Data scoped to tenant via WHERE clauses
- **GitHub API** (Webhooks, OIDC) — External API for repos, Actions, org identity
- **Clerk** (Auth & org) — User authentication, organization mapping to `tenant_id`

**Key Relationships**:

- Frontend → API (API calls with session token)
- API → Database (WHERE tenant_id=?)
- API → GitHub (Webhooks for repo events)
- API → Clerk (Tenant context from org membership)

**Implementation Reference**: ADRs 0001–0004, src/proxy.ts (middleware tenant routing)

---

### 2. Sequence (`sequence.html`)

**Purpose**: Step-by-step workspace load demonstrating tenant scoping

**Participants**: Browser, API, Clerk, Neon DB, GitHub

**Message Flow**:

1. Browser: "Load workspace"
2. API → Clerk: "Verify session"
3. Clerk → API: "tenant_id"
4. API → Database: "SELECT WHERE tenant_id=?"
5. Database → API: "Artifacts"
6. API → GitHub: "GET /repos"
7. GitHub → API: "Repo list"
8. API → Browser: "Render UI"

**Security Pattern**: Every database query includes `WHERE tenant_id=?` filtering; tenant context comes from Clerk org membership

**Implementation Reference**: src/app/api/hosted/** routes, migrations/001-init.sql

---

### 3. Workflow (`workflow.html`)

**Purpose**: Developer interaction loop through Command Centre

**Workflow Stages**:

1. **View Workspace** — Load artifacts, repo list, pending signals
2. **Trigger Skill** — Select and configure a skill from registry
3. **Execute** — Run skill against workspace (tenant-scoped session)
4. **Save Artifact** — Store output to workspace cache
5. **Review** — Inspect results, iterate if needed
6. **Feedback Loop** — Review → View (dashed arrow) allows iteration
7. **Done** — Complete workflow

**Iteration Pattern**: Review stage can loop back to View Workspace for refinement

**Implementation Reference**: CONTEXT.md workflow section, src/components/ UI layer

---

### 4. Dataflow (`dataflow.html`)

**Purpose**: External data ingestion pipeline and signal routing

**Data Sources**:

- **GitHub** — Repository events, Actions status, OIDC tokens
- **Vercel** — Deployment webhooks, production status

**Processing**:

- **Webhook Ingress** — Receives normalized webhook payloads
- **Cache** — Stores enriched events with tenant scoping
- **Command Centre UI** — Renders cached signals to developer

**Feedback Loop**: UI → Cache (dashed arrow) — Skill outputs save back to cache

**Implementation Reference**: src/proxy.ts (webhook routing), server-side cache layer, src/types/signals.ts

---

## Technical Stack

- **Generation**: archify v1 diagram toolkit (tt-a1i/archify)
- **Format**: Standalone HTML with embedded SVG
- **Interactivity**: Vanilla JavaScript (no framework dependencies)
- **Styling**: CSS with dark/light theme toggle
- **Export**: SVG download (PNG requires additional tools)

---

## How to Use

### Opening Diagrams

1. Open any `.html` file in a web browser
2. Use controls:
   - **🌙 Dark Mode** — Toggle dark/light theme
   - **⬇️ Download SVG** — Export as vector graphics
   - **🖼️ Download PNG** — Save as image (requires browser support)

### Navigation

- **Pan**: Click and drag to move view
- **Zoom**: Scroll wheel or pinch on trackpad
- **Hover**: Labels show on component hover
- **Legend**: Color-coded components with explanations

### Embedding

To embed a diagram in documentation:

```html
<iframe src="diagrams/architecture.html" width="100%" height="600"></iframe>
```

Or link directly:

```markdown
[View Architecture Diagram](diagrams/architecture.html)
```

---

## Architecture Principles

All diagrams enforce the multi-tenant architecture defined in ADRs 0001–0004:

1. **Tenant Isolation**: Every component (frontend, API, database) is tenant-aware
2. **Clerk Auth**: Organization membership maps to tenant_id
3. **Row-Level Security**: Database queries always filter by tenant_id
4. **Webhook Routing**: External events are scoped to tenant before processing
5. **Stateless API**: Each request carries tenant context (from Clerk)

---

## References

- **CONTEXT.md** — Domain model, multi-tenancy patterns
- **ADR 0001** — Multi-tenancy schema pattern
- **ADR 0002** — Clerk + GitHub org integration
- **ADR 0003** — Per-tenant Vercel deployments
- **ADR 0004** — Vercel webhook routing
- **src/proxy.ts** — Tenant context middleware
- **migrations/001-init.sql** — Multi-tenant schema

---

## File Locations

```
diagrams/
├── architecture.html    (798 KB) — System topology
├── sequence.html        (799 KB) — API sequence
├── workflow.html        (11 KB)  — Developer loop
├── dataflow.html        (10 KB)  — Data pipeline
├── architecture.json    — Source data (archify v1 format)
├── sequence.json        — Source data (archify v1 format)
├── workflow.json        — Source data (archify v1 format)
└── dataflow.json        — Source data (archify v1 format)
```

---

**Last Updated**: 2025-01-27  
**Version**: 1.0  
**Status**: ✓ All four diagrams generated and interactive
