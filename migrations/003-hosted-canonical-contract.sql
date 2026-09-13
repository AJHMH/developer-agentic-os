-- Migration 003: canonical tenant-scoped hosted persistence contract
-- The developer_agentic_os_* tables are the live Hosted State provider model.

CREATE TABLE IF NOT EXISTS developer_agentic_os_schema_version (
  contract_name text PRIMARY KEY,
  contract_version integer NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_hosted_state (
  tenant_id text NOT NULL,
  state_key text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, state_key)
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_workspace_state (
  tenant_id text NOT NULL,
  state_key text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, state_key)
);

ALTER TABLE developer_agentic_os_hosted_state ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'legacy';
ALTER TABLE developer_agentic_os_workspace_state ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'legacy';
ALTER TABLE developer_agentic_os_hosted_state DROP CONSTRAINT IF EXISTS developer_agentic_os_hosted_state_pkey;
ALTER TABLE developer_agentic_os_workspace_state DROP CONSTRAINT IF EXISTS developer_agentic_os_workspace_state_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_hosted_state_tenant_key
  ON developer_agentic_os_hosted_state (tenant_id, state_key);
CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_workspace_state_tenant_key
  ON developer_agentic_os_workspace_state (tenant_id, state_key);

INSERT INTO developer_agentic_os_schema_version (contract_name, contract_version)
VALUES ('tenant-scoped-hosted-provider', 1)
ON CONFLICT (contract_name) DO UPDATE SET contract_version = EXCLUDED.contract_version,
  migrated_at = now();

CREATE TABLE IF NOT EXISTS developer_agentic_os_migration_status (
  tenant_id text PRIMARY KEY,
  source text NOT NULL,
  target text NOT NULL,
  version integer NOT NULL,
  state text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  error text
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_project_mapping (
  tenant_id text PRIMARY KEY,
  project_id text NOT NULL,
  team_id text,
  webhook_secret_reference text,
  previous_webhook_secret_reference text,
  previous_webhook_secret_expires_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_project_history (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  team_id text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_github_repository_registration (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner text NOT NULL,
  repository text NOT NULL,
  workflow text NOT NULL,
  ref text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (owner, repository)
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_vercel_project_mapping_identity
  ON developer_agentic_os_vercel_project_mapping (project_id, COALESCE(team_id, ''));
CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_github_repository_identity
  ON developer_agentic_os_github_repository_registration (lower(owner), lower(repository));

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_webhook_events (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  deployment_id text NOT NULL,
  event_type text NOT NULL,
  delivery_id text,
  status text,
  url text,
  commit_sha text,
  payload jsonb NOT NULL,
  raw_expires_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, deployment_id, event_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_vercel_webhook_delivery
  ON developer_agentic_os_vercel_webhook_events (delivery_id)
  WHERE delivery_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_deployment_projection (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  deployment_id text NOT NULL,
  event_type text NOT NULL,
  status text,
  url text,
  commit_sha text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, deployment_id)
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_failure_signals (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  deployment_id text NOT NULL,
  source_id text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_webhook_audit (
  id bigserial PRIMARY KEY,
  tenant_id text,
  action text NOT NULL,
  project_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE developer_agentic_os_vercel_webhook_audit ADD COLUMN IF NOT EXISTS tenant_id text;
CREATE INDEX IF NOT EXISTS developer_agentic_os_vercel_webhook_audit_tenant
  ON developer_agentic_os_vercel_webhook_audit (tenant_id, occurred_at);