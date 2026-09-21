-- Migration 007: Hosted Workspace Members with Enforced Roles and Invitations.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspace_members' AND column_name = 'role'
  ) THEN
    ALTER TABLE hosted_workspace_members ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'member';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspace_members' AND column_name = 'joined_at'
  ) THEN
    ALTER TABLE hosted_workspace_members ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hosted_workspace_audit' AND column_name = 'correlation_id'
  ) THEN
    ALTER TABLE hosted_workspace_audit ADD COLUMN correlation_id VARCHAR(255);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hosted_workspace_invitations (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  invited_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by VARCHAR(255),
  revoked_at TIMESTAMPTZ,
  revoked_by VARCHAR(255),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES hosted_workspaces(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hosted_workspace_invitations_tenant_ws
  ON hosted_workspace_invitations(tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_hosted_workspace_invitations_recipient
  ON hosted_workspace_invitations(tenant_id, recipient_email);
