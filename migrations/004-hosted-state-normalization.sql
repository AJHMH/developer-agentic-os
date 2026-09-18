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
  legacy_tenant_id TEXT;
  resolved_tenant_id UUID;
  failed_tenants TEXT[];
  failure_message TEXT;
BEGIN
  IF to_regclass('developer_agentic_os_workspace_state') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_workspace_state
    LOOP
      resolved_tenant_id := NULL;
      SELECT id INTO resolved_tenant_id
      FROM organizations
      WHERE organizations.id::text = legacy_tenant_id OR organizations.clerk_org_id = legacy_tenant_id
      LIMIT 1;
      IF resolved_tenant_id IS NULL
         AND legacy_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        INSERT INTO organizations (name, clerk_org_id)
        VALUES (format('Migrated organization %s', legacy_tenant_id), legacy_tenant_id)
        ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
        RETURNING id INTO resolved_tenant_id;
      END IF;
      IF resolved_tenant_id IS NULL THEN
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
        CONTINUE;
      END IF;

      INSERT INTO migration_status
        (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
      VALUES
        (resolved_tenant_id, 'developer_agentic_os_workspace_state', 'hosted_workspace_tables',
         '004-hosted-state-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO hosted_workspaces (id, tenant_id, owner_id, name, created_at)
        SELECT (workspace->>'id')::uuid, resolved_tenant_id, users.key,
          workspace->>'name', (workspace->>'createdAt')::timestamp
        FROM developer_agentic_os_workspace_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'users') AS users(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(users.value->'workspaces') AS workspace
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          name = EXCLUDED.name,
          created_at = EXCLUDED.created_at;

        INSERT INTO hosted_workspace_members (tenant_id, workspace_id, user_id, active_workspace)
        SELECT resolved_tenant_id, (workspace->>'id')::uuid, users.key,
          NULLIF(users.value->>'activeWorkspaceId', '')::uuid = (workspace->>'id')::uuid
        FROM developer_agentic_os_workspace_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'users') AS users(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(users.value->'workspaces') AS workspace
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE SET
          active_workspace = EXCLUDED.active_workspace;

        INSERT INTO hosted_workspace_users (tenant_id, user_id, active_workspace_id)
        SELECT resolved_tenant_id, users.key,
          NULLIF(users.value->>'activeWorkspaceId', '')::uuid
        FROM developer_agentic_os_workspace_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'users') AS users(key, value)
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          active_workspace_id = EXCLUDED.active_workspace_id;

        INSERT INTO hosted_workspace_audit (id, tenant_id, user_id, workspace_id, action, occurred_at)
        SELECT (event->>'id')::uuid, resolved_tenant_id, event->>'userId',
          NULLIF(event->>'workspaceId', '')::uuid, event->>'action',
          (event->>'occurredAt')::timestamp
        FROM developer_agentic_os_workspace_state AS legacy
        CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'audit') AS audit(event)
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_workspace_state'
          AND target_model = 'hosted_workspace_tables'
          AND version = '004-hosted-state-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate workspace state for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_workspace_state', 'hosted_workspace_tables',
           '004-hosted-state-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;

    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_workspace_state;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_hosted_state') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_hosted_state
    LOOP
      resolved_tenant_id := NULL;
      SELECT id INTO resolved_tenant_id
      FROM organizations
      WHERE organizations.id::text = legacy_tenant_id OR organizations.clerk_org_id = legacy_tenant_id
      LIMIT 1;
      IF resolved_tenant_id IS NULL
         AND legacy_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        INSERT INTO organizations (name, clerk_org_id)
        VALUES (format('Migrated organization %s', legacy_tenant_id), legacy_tenant_id)
        ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
        RETURNING id INTO resolved_tenant_id;
      END IF;
      IF resolved_tenant_id IS NULL THEN
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
        CONTINUE;
      END IF;

      INSERT INTO migration_status
        (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
      VALUES
        (resolved_tenant_id, 'developer_agentic_os_hosted_state', 'hosted_domain_tables',
         '004-hosted-state-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO hosted_repositories (id, tenant_id, workspace_id, local_path, path_identity, created_at)
        SELECT (repository->>'id')::uuid, resolved_tenant_id, repositories.key::uuid,
          repository->>'localPath', repository->>'pathIdentity',
          (repository->>'createdAt')::timestamp
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'repositories') AS repositories(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(repositories.value) AS repository
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO hosted_records (id, tenant_id, workspace_id, kind, value)
        SELECT COALESCE(
                 NULLIF(record.value->>'id', '')::uuid,
                 uuid_generate_v5(
                   uuid_ns_url(),
                   format('%s:%s:%s:%s', resolved_tenant_id, records.key, kinds.key, record.ordinality)
                 )
               ),
               resolved_tenant_id,
               records.key::uuid,
               kinds.key,
               record.value
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'records') AS records(key, value)
        CROSS JOIN LATERAL jsonb_each(records.value) AS kinds(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(kinds.value) WITH ORDINALITY AS record(value, ordinality)
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO hosted_relationships (tenant_id, workspace_id, source_id, target_id, kind)
        SELECT resolved_tenant_id, relationships.key::uuid, relationship->>'from',
          relationship->>'to', relationship->>'kind'
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'relationships') AS relationships(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(relationships.value) AS relationship
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, workspace_id, source_id, target_id, kind) DO NOTHING;

        INSERT INTO hosted_snapshots (id, tenant_id, workspace_id, value)
        SELECT (snapshot->>'id')::uuid, resolved_tenant_id, snapshots.key::uuid, snapshot
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_each(legacy.state->'snapshots') AS snapshots(key, value)
        CROSS JOIN LATERAL jsonb_array_elements(snapshots.value) AS snapshot
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO hosted_connectors (id, tenant_id, workspace_id, value)
        SELECT (connector->>'id')::uuid, resolved_tenant_id, (connector->>'workspaceId')::uuid, connector
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'connectors') AS connector
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO hosted_credentials (id, tenant_id, workspace_id, value)
        SELECT (credential->>'id')::uuid, resolved_tenant_id, (credential->>'workspaceId')::uuid, credential
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'credentials') AS credential
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO hosted_audit (id, tenant_id, workspace_id, value)
        SELECT (event->>'id')::uuid, resolved_tenant_id, NULLIF(event->>'workspaceId', '')::uuid, event
        FROM developer_agentic_os_hosted_state AS legacy
        CROSS JOIN LATERAL jsonb_array_elements(legacy.state->'audit') AS audit(event)
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (id) DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_hosted_state'
          AND target_model = 'hosted_domain_tables'
          AND version = '004-hosted-state-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate hosted state for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_hosted_state', 'hosted_domain_tables',
           '004-hosted-state-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;

    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_hosted_state;
    END IF;
  END IF;
END $$;
