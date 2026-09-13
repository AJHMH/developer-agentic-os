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
  source_id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE vercel_webhook_audit
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_projects_global_project_team
  ON vercel_projects(vercel_project_id, COALESCE(vercel_team_id, ''));

-- Backfill deployment data created by the retired hosted deployment tables.
DO $$
DECLARE
  unmapped_tenants TEXT;
  project_team_collisions TEXT;
BEGIN
  IF to_regclass('developer_agentic_os_vercel_project_mapping') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_vercel_project_mapping AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate vercel project mappings; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    SELECT string_agg(format('%s (team=%s)', collisions.project_id, COALESCE(collisions.team_id, '<none>')), ', ')
    INTO project_team_collisions
    FROM (
      SELECT combined.project_id, combined.team_id
      FROM (
        SELECT organizations.id::text AS tenant_key, legacy.project_id, legacy.team_id
        FROM developer_agentic_os_vercel_project_mapping AS legacy
        JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
        UNION ALL
        SELECT tenant_id::text AS tenant_key, vercel_project_id AS project_id, vercel_team_id AS team_id
        FROM vercel_projects
      ) AS combined
      GROUP BY combined.project_id, combined.team_id
      HAVING COUNT(DISTINCT combined.tenant_key) > 1
    ) AS collisions;
    IF project_team_collisions IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate vercel project mappings; project/team collisions across tenants: %', project_team_collisions;
    END IF;

    INSERT INTO vercel_projects
      (tenant_id, vercel_project_id, vercel_team_id, webhook_secret_reference,
       previous_webhook_secret_reference, previous_webhook_secret_expires_at, updated_at)
    SELECT organizations.id, legacy.project_id, legacy.team_id,
           legacy.webhook_secret_reference, legacy.previous_webhook_secret_reference,
           legacy.previous_webhook_secret_expires_at, legacy.updated_at
    FROM developer_agentic_os_vercel_project_mapping AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    ON CONFLICT (tenant_id, vercel_project_id) DO UPDATE SET
      vercel_team_id = EXCLUDED.vercel_team_id,
      webhook_secret_reference = EXCLUDED.webhook_secret_reference,
      previous_webhook_secret_reference = EXCLUDED.previous_webhook_secret_reference,
      previous_webhook_secret_expires_at = EXCLUDED.previous_webhook_secret_expires_at,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_project_history') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_vercel_project_history AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate vercel project history; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO vercel_project_history
      (tenant_id, vercel_project_id, vercel_team_id, changed_at)
    SELECT organizations.id, legacy.project_id, legacy.team_id, legacy.updated_at
    FROM developer_agentic_os_vercel_project_history AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id;
  END IF;

  IF to_regclass('developer_agentic_os_github_repository_registration') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_github_repository_registration AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate GitHub repository registrations; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO repos
      (id, tenant_id, github_owner, github_repo, deployment_workflow,
       deployment_ref, created_at, updated_at)
    SELECT CASE WHEN legacy.id ~ '^[0-9a-fA-F-]{36}$' THEN legacy.id::uuid ELSE gen_random_uuid() END,
           organizations.id, legacy.owner, legacy.repository, legacy.workflow,
           legacy.ref, legacy.created_at, legacy.created_at
    FROM developer_agentic_os_github_repository_registration AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    ON CONFLICT (tenant_id, github_owner, github_repo) DO UPDATE SET
      deployment_workflow = EXCLUDED.deployment_workflow,
      deployment_ref = EXCLUDED.deployment_ref,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_webhook_events') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_vercel_webhook_events AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate webhook events; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO vercel_webhook_events
      (tenant_id, vercel_project_id, vercel_deployment_id, event_type, delivery_id,
       status, url, commit_sha, payload, raw_expires_at, occurred_at, received_at)
    SELECT organizations.id, legacy.project_id, legacy.deployment_id, legacy.event_type,
           legacy.delivery_id, legacy.status, legacy.url, legacy.commit_sha, legacy.payload,
           legacy.raw_expires_at, legacy.occurred_at, legacy.received_at
    FROM developer_agentic_os_vercel_webhook_events AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    ON CONFLICT (vercel_project_id, vercel_deployment_id, event_type) DO NOTHING;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_deployment_projection') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_vercel_deployment_projection AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate deployment projections; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO vercel_deployment_projections
      (tenant_id, vercel_project_id, vercel_deployment_id, event_type, status, url, commit_sha, occurred_at)
    SELECT organizations.id, legacy.project_id, legacy.deployment_id, legacy.event_type,
           legacy.status, legacy.url, legacy.commit_sha, legacy.occurred_at
    FROM developer_agentic_os_vercel_deployment_projection AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    ON CONFLICT (vercel_project_id, vercel_deployment_id) DO NOTHING;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_failure_signals') IS NOT NULL THEN
    SELECT string_agg(DISTINCT legacy.tenant_id, ', ')
    INTO unmapped_tenants
    FROM developer_agentic_os_vercel_failure_signals AS legacy
    LEFT JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    WHERE organizations.id IS NULL;
    IF unmapped_tenants IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate failure signals; missing organizations for tenant IDs: %', unmapped_tenants;
    END IF;

    INSERT INTO vercel_failure_signals
      (tenant_id, vercel_project_id, vercel_deployment_id, source_id, title, body, created_at)
    SELECT organizations.id, legacy.project_id, legacy.deployment_id, legacy.source_id,
           legacy.title, legacy.body, legacy.created_at
    FROM developer_agentic_os_vercel_failure_signals AS legacy
    JOIN organizations ON organizations.clerk_org_id = legacy.tenant_id
    ON CONFLICT (source_id) DO NOTHING;
  END IF;

  IF to_regclass('developer_agentic_os_vercel_webhook_audit') IS NOT NULL THEN
    INSERT INTO vercel_webhook_audit (tenant_id, action, vercel_project_id, occurred_at)
    SELECT organizations.id, legacy.action, legacy.project_id, legacy.occurred_at
    FROM developer_agentic_os_vercel_webhook_audit AS legacy
    LEFT JOIN vercel_projects ON vercel_projects.vercel_project_id = legacy.project_id
    LEFT JOIN organizations ON organizations.id = vercel_projects.tenant_id;
  END IF;
END $$;

DROP TABLE IF EXISTS developer_agentic_os_vercel_webhook_audit;
DROP TABLE IF EXISTS developer_agentic_os_vercel_failure_signals;
DROP TABLE IF EXISTS developer_agentic_os_vercel_deployment_projection;
DROP TABLE IF EXISTS developer_agentic_os_vercel_webhook_events;
DROP TABLE IF EXISTS developer_agentic_os_github_repository_registration;
DROP TABLE IF EXISTS developer_agentic_os_vercel_project_history;
DROP TABLE IF EXISTS developer_agentic_os_vercel_project_mapping;