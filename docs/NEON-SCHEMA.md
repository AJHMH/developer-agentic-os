# Neon Schema Design for Developer Agentic OS Multi-Tenant

**Date**: 2026-09-09

**Status**: Schema Reference for Implementation

This document defines all tables in Neon PostgreSQL for the multi-tenant SaaS architecture. All user-facing data includes `tenant_id` for row-level isolation.

---

## Core Organization & Auth

### `organizations` (Tenants)

Represents a Clerk org and the app tenant. One row per organization.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  clerk_org_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_clerk_org_id ON organizations(clerk_org_id);
```

### `users` (App Users)

Developers signed in via Clerk. Tracks their GitHub link.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  github_username VARCHAR(255),
  github_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_clerk_user_id ON users(clerk_user_id);
CREATE INDEX idx_github_username ON users(github_username);
```

### `org_members` (User-to-Org Memberships)

Links users to organizations they're members of (via Clerk invite).

```sql
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- 'admin', 'member'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, user_id),
  INDEX idx_tenant_members (tenant_id),
  INDEX idx_user_orgs (user_id)
);
```

---

## GitHub Integration

### `repos` (Connected GitHub Repositories)

GitHub repositories connected to an org's workspace.

```sql
CREATE TABLE repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  github_url VARCHAR(255),
  default_branch VARCHAR(255) DEFAULT 'main',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, github_owner, github_repo),
  INDEX idx_tenant_repos (tenant_id),
  INDEX idx_github_owner_repo (github_owner, github_repo)
);
```

### `github_issues` (Cached GitHub Issues)

Cached GitHub issue metadata. Source of truth is GitHub; this is a cache.

```sql
CREATE TABLE github_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  github_issue_number INTEGER NOT NULL,
  title VARCHAR(255),
  state VARCHAR(50), -- 'open', 'closed'
  assignee VARCHAR(255),
  labels JSONB, -- array of label strings
  synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, repo_id, github_issue_number),
  INDEX idx_tenant_issues (tenant_id),
  INDEX idx_repo_issues (repo_id)
);
```

### `github_pull_requests` (Cached GitHub PRs)

Cached GitHub pull request metadata.

```sql
CREATE TABLE github_pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  github_pr_number INTEGER NOT NULL,
  title VARCHAR(255),
  state VARCHAR(50), -- 'open', 'closed', 'merged'
  author VARCHAR(255),
  labels JSONB,
  synced_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, repo_id, github_pr_number),
  INDEX idx_tenant_prs (tenant_id),
  INDEX idx_repo_prs (repo_id)
);
```

---

## Vercel Integration

### `vercel_projects` (Tenant's Vercel Project)

Maps each org to its Vercel project.

```sql
CREATE TABLE vercel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  domain VARCHAR(255),
  webhook_secret VARCHAR(255), -- HMAC secret for webhook validation
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id),
  INDEX idx_vercel_project (vercel_project_id),
  INDEX idx_tenant_vercel (tenant_id)
);
```

### `deployment_events` (Vercel Deployment History)

Records of Vercel deployment events (success, failure, etc.).

```sql
CREATE TABLE deployment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50), -- 'ready', 'error', 'created'
  status VARCHAR(50), -- 'success', 'failed', 'running'
  url VARCHAR(255),
  commit_sha VARCHAR(255),
  environment VARCHAR(50) DEFAULT 'production', -- 'production', 'preview'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_deployment_id),
  INDEX idx_tenant_deployments (tenant_id),
  INDEX idx_vercel_project_id (vercel_project_id),
  INDEX idx_created_at (created_at)
);
```

---

## Core Application Data

### `artifacts` (Persistent Outputs)

Plans, briefs, memos, generated assets, etc.

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(50), -- 'plan', 'brief', 'memo', 'release', etc.
  title VARCHAR(255) NOT NULL,
  content TEXT, -- Markdown or JSON
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_draft BOOLEAN DEFAULT FALSE,
  tags JSONB, -- array of tag strings
  UNIQUE (tenant_id, id),
  INDEX idx_tenant_artifacts (tenant_id),
  INDEX idx_created_at (created_at)
);
```

### `work_items` (Tasks, Bugs, Features)

Actionable work in the Focus Board.

```sql
CREATE TABLE work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'in_progress', 'done', 'blocked'
  priority VARCHAR(50) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,
  related_github_issue INTEGER,
  due_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  INDEX idx_tenant_work_items (tenant_id),
  INDEX idx_status (status),
  INDEX idx_due_date (due_date)
);
```

### `incoming_signals` (Triage Queue)

Email, alerts, notifications awaiting triage.

```sql
CREATE TABLE incoming_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type VARCHAR(50), -- 'email', 'github', 'vercel', 'manual'
  source_id VARCHAR(255), -- stable provider identifier
  title VARCHAR(255) NOT NULL,
  body TEXT,
  triage_status VARCHAR(50) DEFAULT 'new', -- 'new', 'reviewed', 'dismissed', 'actioned'
  related_work_item UUID REFERENCES work_items(id) ON DELETE SET NULL,
  related_artifact UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, source_type, source_id),
  INDEX idx_tenant_signals (tenant_id),
  INDEX idx_triage_status (triage_status)
);
```

---

## Skills & Routines

### `skills` (Skill Definitions)

Available skill commands.

```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  command VARCHAR(255) NOT NULL, -- '/repo-summary', '/release-readiness', etc.
  display_name VARCHAR(255),
  description TEXT,
  model VARCHAR(50) DEFAULT 'claude-3.5-sonnet', -- AI model name
  effort_level VARCHAR(50) DEFAULT 'medium', -- 'quick', 'medium', 'deep'
  is_builtin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, command),
  INDEX idx_tenant_skills (tenant_id)
);
```

### `skill_runs` (Execution History)

Records of skill invocations.

```sql
CREATE TABLE skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,
  command VARCHAR(255),
  status VARCHAR(50), -- 'queued', 'running', 'succeeded', 'failed'
  result_artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_tenant_skill_runs (tenant_id),
  INDEX idx_status (status)
);
```

### `routines` (Scheduled Workflows)

Nightly digests, weekly reviews, etc.

```sql
CREATE TABLE routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  schedule VARCHAR(255), -- cron format or natural language
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, name),
  INDEX idx_tenant_routines (tenant_id)
);
```

### `routine_runs` (Execution History)

Records of routine invocations.

```sql
CREATE TABLE routine_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  status VARCHAR(50), -- 'queued', 'running', 'succeeded', 'failed', 'skipped'
  triggered_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  result_artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  error_message TEXT,
  INDEX idx_tenant_routine_runs (tenant_id),
  INDEX idx_routine_id (routine_id),
  INDEX idx_triggered_at (triggered_at)
);
```

---

## Second Brain / Graph

### `graph_nodes` (Second Brain Nodes)

Repo, area, file, artifact, skill nodes in the knowledge graph.

```sql
CREATE TABLE graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_type VARCHAR(50), -- 'repo', 'area', 'file', 'artifact', 'skill', 'routine', 'work_item'
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entity_id VARCHAR(255), -- foreign key to the entity it represents
  metadata JSONB, -- type-specific metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, node_type, entity_id),
  INDEX idx_tenant_nodes (tenant_id),
  INDEX idx_node_type (node_type)
);
```

### `graph_links` (Second Brain Edges)

Connections between nodes.

```sql
CREATE TABLE graph_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  link_type VARCHAR(50), -- 'contains', 'references', 'produced', 'used_context'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, source_node_id, target_node_id, link_type),
  INDEX idx_tenant_links (tenant_id),
  INDEX idx_source_node (source_node_id),
  INDEX idx_target_node (target_node_id)
);
```

---

## Handoffs & Session State

### `handoffs` (Session Handoff Artifacts)

Snapshots of work state for later sessions.

```sql
CREATE TABLE handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  session_date DATE,
  repo_context VARCHAR(255),
  current_branch VARCHAR(255),
  changed_files JSONB, -- array of file paths
  work_items_summary TEXT,
  artifacts_summary TEXT,
  decisions JSONB, -- array of decision records
  blockers TEXT,
  next_actions TEXT,
  is_draft BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  finalized_at TIMESTAMP,
  INDEX idx_tenant_handoffs (tenant_id),
  INDEX idx_session_date (session_date)
);
```

---

## Email Integration

### `emails` (Synced Email)

Email signals from the workspace inbox.

```sql
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_message_id VARCHAR(255) UNIQUE,
  sender VARCHAR(255),
  subject VARCHAR(255),
  body TEXT,
  received_at TIMESTAMP,
  is_processed BOOLEAN DEFAULT FALSE,
  related_work_item UUID REFERENCES work_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_tenant_emails (tenant_id),
  INDEX idx_received_at (received_at)
);
```

---

## Focus Board

### `focus_board_items` (Daily Focus)

Curated work items and artifacts for the Focus Board.

```sql
CREATE TABLE focus_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_item_id UUID REFERENCES work_items(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE CASCADE,
  category VARCHAR(50), -- 'active', 'due', 'blocked', 'recent'
  position INTEGER, -- sort order
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_tenant_items (tenant_id),
  INDEX idx_category (category)
);
```

---

## Indexes Summary

Key composite indexes for multi-tenant queries:

```sql
-- Ensure tenant_id is indexed on every table
CREATE INDEX idx_tenant_* ON table_name(tenant_id);

-- Composite indexes for common queries
CREATE INDEX idx_tenant_status ON work_items(tenant_id, status);
CREATE INDEX idx_tenant_repo_issue ON github_issues(tenant_id, repo_id, github_issue_number);
CREATE INDEX idx_tenant_created ON artifacts(tenant_id, created_at DESC);
CREATE INDEX idx_tenant_vercel_project ON vercel_projects(tenant_id, vercel_project_id);
```

---

## Migration Strategy

### Phase 1: Schema Creation

1. Run all CREATE TABLE statements
2. Create indexes
3. Verify foreign keys

### Phase 2: Data Migration (from JSON to Neon)

1. Read existing `.developer-agentic-os/` JSON files
2. Transform to Neon schema
3. Create a single test tenant
4. Migrate all local data into it

### Phase 3: Application Integration

1. Replace `json-file.ts` store adapter with Neon adapter
2. Ensure every query includes `tenant_id` filtering
3. Test with multi-tenant fixtures

---

## Queries Quick Reference

### Example: Get all artifacts for a tenant

```sql
SELECT * FROM artifacts
WHERE tenant_id = $1
ORDER BY created_at DESC;
```

### Example: Get active work items for a dev

```sql
SELECT * FROM work_items
WHERE tenant_id = $1
  AND assigned_to = $2
  AND status != 'done'
ORDER BY due_date ASC;
```

### Example: Route a Vercel webhook to tenant

```sql
SELECT tenant_id FROM vercel_projects
WHERE vercel_project_id = $1;
```

### Example: Verify GitHub membership

```sql
SELECT u.github_username
FROM users u
  JOIN org_members om ON om.user_id = u.id
WHERE om.tenant_id = $1
  AND u.id = $2;
```

---

## Neon-Specific Features (Optional, Future)

- **Row-Level Security (RLS)**: Add PostgreSQL RLS policies to enforce tenant_id filtering at the DB level
- **Logical Replication**: For per-tenant snapshots or backups
- **Partitioning**: Partition large tables (artifacts, work_items, deployment_events) by tenant_id for performance

For v1, row-level filtering in the application is sufficient. RLS can be added later.

---

## Next Steps

1. **Review** this schema against your domain model
2. **Test** migrations from JSON → Neon with real data
3. **Implement** the Neon adapter in place of `json-file.ts`
4. **Build out** Clerk + GitHub OAuth setup (ADR 0002)
5. **Set up** Vercel webhook routing (ADR 0004)
