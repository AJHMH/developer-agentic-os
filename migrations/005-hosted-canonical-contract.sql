-- Migration 005: authoritative fresh-install hosted persistence contract.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  clerk_org_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_clerk_org_id ON organizations(clerk_org_id);

CREATE TABLE IF NOT EXISTS repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  deployment_workflow VARCHAR(255),
  deployment_ref VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, github_owner, github_repo)
);

CREATE INDEX IF NOT EXISTS idx_repos_tenant_id ON repos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repos_github_owner_repo ON repos(github_owner, github_repo);

CREATE TABLE IF NOT EXISTS vercel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  webhook_secret_reference VARCHAR(512),
  previous_webhook_secret_reference VARCHAR(512),
  previous_webhook_secret_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id)
);

CREATE INDEX IF NOT EXISTS idx_vercel_projects_tenant_id ON vercel_projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_vercel_project_id ON vercel_projects(vercel_project_id);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_project_team
  ON vercel_projects(vercel_project_id, COALESCE(vercel_team_id, ''));

CREATE TABLE IF NOT EXISTS vercel_project_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vercel_project_history_tenant_id
  ON vercel_project_history(tenant_id, changed_at);

CREATE TABLE IF NOT EXISTS migration_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_model VARCHAR(100) NOT NULL,
  target_model VARCHAR(100) NOT NULL,
  version VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL,
  completed_at TIMESTAMP,
  failure_details TEXT,
  UNIQUE (tenant_id, source_model, target_model, version)
);

CREATE TABLE IF NOT EXISTS vercel_failure_signals (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, source_id)
);

CREATE TABLE IF NOT EXISTS vercel_webhook_events (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  delivery_id VARCHAR(255),
  status VARCHAR(50),
  url VARCHAR(255),
  commit_sha VARCHAR(255),
  payload JSONB NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  raw_expires_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id, vercel_deployment_id, event_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_delivery_id
  ON vercel_webhook_events(delivery_id) WHERE delivery_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vercel_deployment_projections (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  status VARCHAR(50),
  url VARCHAR(255),
  commit_sha VARCHAR(255),
  occurred_at TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, vercel_project_id, vercel_deployment_id)
);

ALTER TABLE vercel_deployment_projections
  DROP CONSTRAINT IF EXISTS vercel_deployment_projections_pkey;
ALTER TABLE vercel_deployment_projections
  ADD PRIMARY KEY (tenant_id, vercel_project_id, vercel_deployment_id);

ALTER TABLE vercel_failure_signals
  DROP CONSTRAINT IF EXISTS vercel_failure_signals_pkey;
ALTER TABLE vercel_failure_signals
  ADD PRIMARY KEY (tenant_id, source_id);

CREATE TABLE IF NOT EXISTS vercel_webhook_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  vercel_project_id VARCHAR(255),
  occurred_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hosted_workspaces (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS hosted_workspace_members (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  active_workspace BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id, workspace_id, user_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_workspace_users (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  active_workspace_id UUID,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, active_workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hosted_workspace_audit (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  workspace_id UUID,
  action VARCHAR(100) NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_repositories (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  local_path TEXT NOT NULL,
  path_identity TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  kind VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_relationships (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind VARCHAR(100) NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, source_id, target_id, kind),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_snapshots (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  value JSONB NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_connectors (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  value JSONB NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_credentials (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  value JSONB NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hosted_audit (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  value JSONB NOT NULL,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hosted_records_workspace_kind
  ON hosted_records(tenant_id, workspace_id, kind);
CREATE INDEX IF NOT EXISTS idx_hosted_audit_workspace
  ON hosted_audit(tenant_id, workspace_id);
