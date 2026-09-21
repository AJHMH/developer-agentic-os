-- Migration 008: Hosted Workspace Approvals, Policies, and Destructive Tombstones.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspaces' AND column_name = 'status'
  ) THEN
    ALTER TABLE hosted_workspaces ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspaces' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE hosted_workspaces ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspaces' AND column_name = 'recovery_backup_id'
  ) THEN
    ALTER TABLE hosted_workspaces ADD COLUMN recovery_backup_id VARCHAR(255);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspaces' AND column_name = 'recovery_info'
  ) THEN
    ALTER TABLE hosted_workspaces ADD COLUMN recovery_info JSONB;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hosted_workspace_approvals (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target VARCHAR(255) NOT NULL,
  version VARCHAR(100) NOT NULL,
  reason TEXT NOT NULL,
  correlation_id VARCHAR(255) NOT NULL,
  approved_by VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by VARCHAR(255),
  revoked_at TIMESTAMPTZ,
  revoked_by VARCHAR(255),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hosted_workspace_approvals_tenant_ws
  ON hosted_workspace_approvals(tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_hosted_workspace_approvals_actor
  ON hosted_workspace_approvals(tenant_id, actor_id);

CREATE INDEX IF NOT EXISTS idx_hosted_workspaces_status
  ON hosted_workspaces(tenant_id, status);

CREATE TABLE IF NOT EXISTS hosted_workspace_policies (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  require_approval_for_delete BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval_for_export BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval_for_transfer BOOLEAN NOT NULL DEFAULT TRUE,
  approval_expiry_window_seconds INT NOT NULL DEFAULT 3600,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(255) NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);
