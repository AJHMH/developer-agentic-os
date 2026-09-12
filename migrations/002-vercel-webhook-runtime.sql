-- Upgrade existing Vercel mappings and provision the runtime webhook tables.
ALTER TABLE vercel_projects ADD COLUMN IF NOT EXISTS webhook_secret_reference VARCHAR(512);
ALTER TABLE vercel_projects ADD COLUMN IF NOT EXISTS previous_webhook_secret_reference VARCHAR(512);
ALTER TABLE vercel_projects ADD COLUMN IF NOT EXISTS previous_webhook_secret_expires_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vercel_projects_project_team
  ON vercel_projects(vercel_project_id, COALESCE(vercel_team_id, ''));

CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_project_mapping (
  tenant_id text PRIMARY KEY,
  project_id text NOT NULL,
  team_id text,
  webhook_secret_reference text,
  previous_webhook_secret_reference text,
  previous_webhook_secret_expires_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_vercel_project_mapping_identity
  ON developer_agentic_os_vercel_project_mapping (project_id, COALESCE(team_id, ''));

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
  action text NOT NULL,
  project_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_github_repository_identity
  ON developer_agentic_os_github_repository_registration (lower(owner), lower(repository));
