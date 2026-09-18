-- Migration 003: normalized hosted deployment metadata.
-- Deployment resolution uses the Schema A tenant and repository tables.

ALTER TABLE repos ADD COLUMN IF NOT EXISTS deployment_workflow VARCHAR(255);
ALTER TABLE repos ADD COLUMN IF NOT EXISTS deployment_ref VARCHAR(255);

CREATE TABLE IF NOT EXISTS vercel_project_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  changed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vercel_project_history_tenant_id
  ON vercel_project_history(tenant_id, changed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_project_history_dedup
  ON vercel_project_history(tenant_id, vercel_project_id, COALESCE(vercel_team_id, ''), changed_at);

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

ALTER TABLE vercel_webhook_audit
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

DO $$
DECLARE
  webhook_constraint_name TEXT;
  projection_constraint_name TEXT;
  failure_signal_constraint_name TEXT;
BEGIN
  SELECT conname INTO webhook_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'vercel_webhook_events'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE 'UNIQUE (vercel_project_id, vercel_deployment_id, event_type)%';
  IF webhook_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE vercel_webhook_events DROP CONSTRAINT %I', webhook_constraint_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'vercel_webhook_events'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE 'UNIQUE (tenant_id, vercel_project_id, vercel_deployment_id, event_type)%'
  ) THEN
    ALTER TABLE vercel_webhook_events
      ADD CONSTRAINT vercel_webhook_events_tenant_event_key
      UNIQUE (tenant_id, vercel_project_id, vercel_deployment_id, event_type);
  END IF;

  SELECT conname INTO projection_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'vercel_deployment_projections'::regclass
    AND contype = 'p'
    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (vercel_project_id, vercel_deployment_id)';
  IF projection_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE vercel_deployment_projections DROP CONSTRAINT %I',
      projection_constraint_name
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'vercel_deployment_projections'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) =
        'PRIMARY KEY (tenant_id, vercel_project_id, vercel_deployment_id)'
  ) THEN
    ALTER TABLE vercel_deployment_projections
      ADD PRIMARY KEY (tenant_id, vercel_project_id, vercel_deployment_id);
  END IF;

  SELECT conname INTO failure_signal_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'vercel_failure_signals'::regclass
    AND contype = 'p'
    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (source_id)';
  IF failure_signal_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE vercel_failure_signals DROP CONSTRAINT %I',
      failure_signal_constraint_name
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'vercel_failure_signals'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (tenant_id, source_id)'
  ) THEN
    ALTER TABLE vercel_failure_signals
      ADD PRIMARY KEY (tenant_id, source_id);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_vercel_projects_global_project_team;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_projects_tenant_project_team
  ON vercel_projects(tenant_id, vercel_project_id, COALESCE(vercel_team_id, ''));
DROP INDEX IF EXISTS idx_vercel_webhook_delivery_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_delivery_id
  ON vercel_webhook_events(tenant_id, delivery_id) WHERE delivery_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_webhook_audit_dedup
  ON vercel_webhook_audit(COALESCE(tenant_id::text, ''), action, COALESCE(vercel_project_id, ''), occurred_at);

-- Backfill deployment data created by the retired hosted deployment tables.
DO $$
DECLARE
  legacy_tenant_id TEXT;
  resolved_tenant_id UUID;
  failed_tenants TEXT[];
  failure_message TEXT;
BEGIN
  IF to_regclass('developer_agentic_os_vercel_project_mapping') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_project_mapping
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_project_mapping', 'vercel_projects',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_projects
          (tenant_id, vercel_project_id, vercel_team_id, webhook_secret_reference,
           previous_webhook_secret_reference, previous_webhook_secret_expires_at, updated_at)
        SELECT resolved_tenant_id, legacy.project_id, legacy.team_id,
               legacy.webhook_secret_reference, legacy.previous_webhook_secret_reference,
               legacy.previous_webhook_secret_expires_at, legacy.updated_at
        FROM developer_agentic_os_vercel_project_mapping AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, vercel_project_id) DO UPDATE SET
          vercel_team_id = EXCLUDED.vercel_team_id,
          webhook_secret_reference = EXCLUDED.webhook_secret_reference,
          previous_webhook_secret_reference = EXCLUDED.previous_webhook_secret_reference,
          previous_webhook_secret_expires_at = EXCLUDED.previous_webhook_secret_expires_at,
          updated_at = EXCLUDED.updated_at;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_project_mapping'
          AND target_model = 'vercel_projects'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate vercel project mapping for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_project_mapping', 'vercel_projects',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_project_mapping;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_project_history') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_project_history
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_project_history', 'vercel_project_history',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_project_history
          (tenant_id, vercel_project_id, vercel_team_id, changed_at)
        SELECT resolved_tenant_id, legacy.project_id, legacy.team_id, legacy.updated_at
        FROM developer_agentic_os_vercel_project_history AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_project_history'
          AND target_model = 'vercel_project_history'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate vercel project history for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_project_history', 'vercel_project_history',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_project_history;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_github_repository_registration') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_github_repository_registration
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
        (resolved_tenant_id, 'developer_agentic_os_github_repository_registration', 'repos',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO repos
          (id, tenant_id, github_owner, github_repo, deployment_workflow,
           deployment_ref, created_at, updated_at)
        SELECT CASE WHEN legacy.id ~ '^[0-9a-fA-F-]{36}$' THEN legacy.id::uuid ELSE gen_random_uuid() END,
               resolved_tenant_id, legacy.owner, legacy.repository, legacy.workflow,
               legacy.ref, legacy.created_at, legacy.created_at
        FROM developer_agentic_os_github_repository_registration AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, github_owner, github_repo) DO UPDATE SET
          deployment_workflow = EXCLUDED.deployment_workflow,
          deployment_ref = EXCLUDED.deployment_ref,
          updated_at = EXCLUDED.updated_at;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_github_repository_registration'
          AND target_model = 'repos'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate GitHub repository registrations for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_github_repository_registration', 'repos',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_github_repository_registration;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_webhook_events') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_webhook_events
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_webhook_events', 'vercel_webhook_events',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_webhook_events
          (tenant_id, vercel_project_id, vercel_deployment_id, event_type, delivery_id,
           status, url, commit_sha, payload, raw_expires_at, occurred_at, received_at)
        SELECT resolved_tenant_id, legacy.project_id, legacy.deployment_id, legacy.event_type,
               legacy.delivery_id, legacy.status, legacy.url, legacy.commit_sha, legacy.payload,
               legacy.raw_expires_at, legacy.occurred_at, legacy.received_at
        FROM developer_agentic_os_vercel_webhook_events AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, vercel_project_id, vercel_deployment_id, event_type) DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_webhook_events'
          AND target_model = 'vercel_webhook_events'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate webhook events for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_webhook_events', 'vercel_webhook_events',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_webhook_events;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_deployment_projection') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_deployment_projection
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_deployment_projection', 'vercel_deployment_projections',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_deployment_projections
          (tenant_id, vercel_project_id, vercel_deployment_id, event_type, status, url, commit_sha, occurred_at)
        SELECT resolved_tenant_id, legacy.project_id, legacy.deployment_id, legacy.event_type,
               legacy.status, legacy.url, legacy.commit_sha, legacy.occurred_at
        FROM developer_agentic_os_vercel_deployment_projection AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, vercel_project_id, vercel_deployment_id) DO UPDATE SET
          event_type = EXCLUDED.event_type,
          status = EXCLUDED.status,
          url = EXCLUDED.url,
          commit_sha = EXCLUDED.commit_sha,
          occurred_at = EXCLUDED.occurred_at
        WHERE EXCLUDED.occurred_at >= vercel_deployment_projections.occurred_at;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_deployment_projection'
          AND target_model = 'vercel_deployment_projections'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate deployment projections for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_deployment_projection', 'vercel_deployment_projections',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_deployment_projection;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_failure_signals') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_failure_signals
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_failure_signals', 'vercel_failure_signals',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_failure_signals
          (tenant_id, vercel_project_id, vercel_deployment_id, source_id, title, body, created_at)
        SELECT resolved_tenant_id, legacy.project_id, legacy.deployment_id, legacy.source_id,
               legacy.title, legacy.body, legacy.created_at
        FROM developer_agentic_os_vercel_failure_signals AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT (tenant_id, source_id) DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_failure_signals'
          AND target_model = 'vercel_failure_signals'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate failure signals for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_failure_signals', 'vercel_failure_signals',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_failure_signals;
    END IF;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_webhook_audit') IS NOT NULL THEN
    failed_tenants := ARRAY[]::TEXT[];
    FOR legacy_tenant_id IN
      SELECT DISTINCT tenant_id FROM developer_agentic_os_vercel_webhook_audit
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
        (resolved_tenant_id, 'developer_agentic_os_vercel_webhook_audit', 'vercel_webhook_audit',
         '003-hosted-deployment-normalization', 'in_progress', NULL, NULL)
      ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        failure_details = EXCLUDED.failure_details;

      BEGIN
        INSERT INTO vercel_webhook_audit (tenant_id, action, vercel_project_id, occurred_at)
        SELECT resolved_tenant_id, legacy.action, legacy.project_id, legacy.occurred_at
        FROM developer_agentic_os_vercel_webhook_audit AS legacy
        WHERE legacy.tenant_id = legacy_tenant_id
        ON CONFLICT DO NOTHING;

        UPDATE migration_status
        SET status = 'completed', completed_at = NOW(), failure_details = NULL
        WHERE tenant_id = resolved_tenant_id
          AND source_model = 'developer_agentic_os_vercel_webhook_audit'
          AND target_model = 'vercel_webhook_audit'
          AND version = '003-hosted-deployment-normalization';
      EXCEPTION WHEN OTHERS THEN
        failure_message := format('Failed to migrate webhook audit for tenant %s: %s', legacy_tenant_id, SQLERRM);
        INSERT INTO migration_status
          (tenant_id, source_model, target_model, version, status, completed_at, failure_details)
        VALUES
          (resolved_tenant_id, 'developer_agentic_os_vercel_webhook_audit', 'vercel_webhook_audit',
           '003-hosted-deployment-normalization', 'failed', NULL, failure_message)
        ON CONFLICT (tenant_id, source_model, target_model, version) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          failure_details = EXCLUDED.failure_details;
        failed_tenants := array_append(failed_tenants, legacy_tenant_id);
      END;
    END LOOP;
    IF cardinality(failed_tenants) = 0 THEN
      DROP TABLE IF EXISTS developer_agentic_os_vercel_webhook_audit;
    END IF;
  END IF;
END $$;
