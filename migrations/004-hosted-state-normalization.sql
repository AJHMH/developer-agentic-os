-- Migration 004: replace general hosted/workspace JSONB blobs with tenant-scoped tables.

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

-- Backfill the retired hosted/workspace JSONB rows before removing their tables.
DO $$
DECLARE
  unmapped_tenants TEXT;
BEGIN
  IF to_regclass('developer_agentic_os_workspace_state') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_workspace_state AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate workspace state; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO hosted_workspaces (id, tenant_id, owner_id, name, created_at)
    SELECT (workspace->>'id')::uuid, organizations.id, users.key,
      workspace->>'name', (workspace->>'createdAt')::timestamp
    FROM developer_agentic_os_workspace_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'users') AS users(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(users.value->'workspaces') AS workspace
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_workspace_users (tenant_id, user_id, active_workspace_id)
    SELECT organizations.id, users.key,
      NULLIF(users.value->>'activeWorkspaceId', '')::uuid
    FROM developer_agentic_os_workspace_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'users') AS users(key, value)
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
      active_workspace_id = EXCLUDED.active_workspace_id;

    INSERT INTO hosted_workspace_audit (id, tenant_id, user_id, workspace_id, action, occurred_at)
    SELECT (event->>'id')::uuid, organizations.id, event->>'userId',
      NULLIF(event->>'workspaceId', '')::uuid, event->>'action',
      (event->>'occurredAt')::timestamp
    FROM developer_agentic_os_workspace_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'audit') AS audit(event)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF to_regclass('developer_agentic_os_hosted_state') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_hosted_state AS legacy
    LEFT JOIN organizations
      ON organizations.id::text = legacy.tenant_id OR organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate hosted domain state; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO hosted_repositories (id, tenant_id, workspace_id, local_path, path_identity, created_at)
    SELECT (repository->>'id')::uuid, organizations.id, repositories.key,
      repository->>'localPath', repository->>'pathIdentity',
      (repository->>'createdAt')::timestamp
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'repositories') AS repositories(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(repositories.value) AS repository
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_records (id, tenant_id, workspace_id, kind, value)
    SELECT COALESCE(NULLIF(record->>'id', '')::uuid, gen_random_uuid()), organizations.id,
      records.key, kinds.key, record
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'records') AS records(key, value)
    CROSS JOIN LATERAL jsonb_each(records.value) AS kinds(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(kinds.value) AS record
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_relationships (tenant_id, workspace_id, source_id, target_id, kind)
    SELECT organizations.id, relationships.key, relationship->>'from',
      relationship->>'to', relationship->>'kind'
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'relationships') AS relationships(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(relationships.value) AS relationship
    ON CONFLICT (tenant_id, workspace_id, source_id, target_id, kind) DO NOTHING;

    INSERT INTO hosted_snapshots (id, tenant_id, workspace_id, value)
    SELECT (snapshot->>'id')::uuid, organizations.id, snapshots.key, snapshot
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_each(legacy.state->'snapshots') AS snapshots(key, value)
    CROSS JOIN LATERAL jsonb_array_elements(snapshots.value) AS snapshot
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_connectors (id, tenant_id, workspace_id, value)
    SELECT (connector->>'id')::uuid, organizations.id, connector->>'workspaceId', connector
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'connectors') AS connector
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_credentials (id, tenant_id, workspace_id, value)
    SELECT (credential->>'id')::uuid, organizations.id, credential->>'workspaceId', credential
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.id::text = legacy.tenant_id OR organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'credentials') AS credential
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO hosted_audit (id, tenant_id, workspace_id, value)
    SELECT (event->>'id')::uuid, organizations.id, NULLIF(event->>'workspaceId', '')::uuid, event
    FROM developer_agentic_os_hosted_state AS legacy
    JOIN organizations ON organizations.id::text = legacy.tenant_id OR organizations.clerk_org_id = legacy.tenant_id
    CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'audit') AS audit(event)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DROP TABLE IF EXISTS developer_agentic_os_workspace_state;
DROP TABLE IF EXISTS developer_agentic_os_hosted_state;
