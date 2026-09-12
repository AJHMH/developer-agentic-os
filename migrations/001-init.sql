-- Migration 001: Initialize multi-tenant schema for Developer Agentic OS
-- This migration creates all core tables for the Neon PostgreSQL database
-- with row-level tenant_id isolation for multi-tenancy

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE ORGANIZATION & AUTH TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  clerk_org_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_clerk_org_id ON organizations(clerk_org_id);

-- Users table (global, not per-tenant)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  github_username VARCHAR(255),
  github_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_github_username ON users(github_username);

-- Org membership (links users to orgs)
CREATE TABLE IF NOT EXISTS org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_tenant_id ON org_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members(user_id);

-- ============================================================================
-- GITHUB INTEGRATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  github_url VARCHAR(255),
  default_branch VARCHAR(255) DEFAULT 'main',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, github_owner, github_repo)
);

CREATE INDEX IF NOT EXISTS idx_repos_tenant_id ON repos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_repos_github_owner_repo ON repos(github_owner, github_repo);

-- Cached GitHub issues
CREATE TABLE IF NOT EXISTS github_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL,
  github_issue_number INTEGER NOT NULL,
  title VARCHAR(255),
  state VARCHAR(50),
  assignee VARCHAR(255),
  labels JSONB,
  synced_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, repo_id) REFERENCES repos(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, repo_id, github_issue_number)
);

CREATE INDEX IF NOT EXISTS idx_github_issues_tenant_id ON github_issues(tenant_id);
CREATE INDEX IF NOT EXISTS idx_github_issues_repo_id ON github_issues(repo_id);

-- Cached GitHub PRs
CREATE TABLE IF NOT EXISTS github_pull_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL,
  github_pr_number INTEGER NOT NULL,
  title VARCHAR(255),
  state VARCHAR(50),
  author VARCHAR(255),
  labels JSONB,
  synced_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, repo_id) REFERENCES repos(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, repo_id, github_pr_number)
);

CREATE INDEX IF NOT EXISTS idx_github_pull_requests_tenant_id ON github_pull_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_github_pull_requests_repo_id ON github_pull_requests(repo_id);

-- ============================================================================
-- VERCEL INTEGRATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS vercel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  domain VARCHAR(255),
  webhook_secret_reference VARCHAR(512),
  previous_webhook_secret_reference VARCHAR(512),
  previous_webhook_secret_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id)
);

CREATE INDEX IF NOT EXISTS idx_vercel_projects_tenant_id ON vercel_projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_vercel_project_id ON vercel_projects(vercel_project_id);

-- Vercel deployment event history
CREATE TABLE IF NOT EXISTS deployment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50),
  status VARCHAR(50),
  url VARCHAR(255),
  commit_sha VARCHAR(255),
  environment VARCHAR(50) DEFAULT 'production',
  delivery_id VARCHAR(255),
  payload JSONB,
  occurred_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id, vercel_deployment_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_deployment_events_tenant_id ON deployment_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployment_events_vercel_project_id ON deployment_events(vercel_project_id);
CREATE INDEX IF NOT EXISTS idx_deployment_events_created_at ON deployment_events(created_at);

-- Hosted webhook ingestion, projection, and audit history
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
  UNIQUE (vercel_project_id, vercel_deployment_id, event_type)
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
  PRIMARY KEY (vercel_project_id, vercel_deployment_id)
);

CREATE TABLE IF NOT EXISTS vercel_webhook_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,
  vercel_project_id VARCHAR(255),
  occurred_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- CORE APPLICATION DATA TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type VARCHAR(50),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_draft BOOLEAN DEFAULT FALSE,
  tags JSONB,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_tenant_id ON artifacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(tenant_id, created_at DESC);

-- Work items (tasks, bugs, features)
CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'open',
  priority VARCHAR(50) DEFAULT 'medium',
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  repo_id UUID,
  related_github_issue INTEGER,
  due_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, repo_id) REFERENCES repos(tenant_id, id) ON DELETE SET NULL,
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_work_items_tenant_id ON work_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date);

-- Incoming signals (email, alerts, notifications)
CREATE TABLE IF NOT EXISTS incoming_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type VARCHAR(50),
  source_id VARCHAR(255),
  title VARCHAR(255) NOT NULL,
  body TEXT,
  triage_status VARCHAR(50) DEFAULT 'new',
  related_work_item UUID,
  related_artifact UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, related_work_item) REFERENCES work_items(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, related_artifact) REFERENCES artifacts(tenant_id, id) ON DELETE SET NULL,
  UNIQUE (tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_incoming_signals_tenant_id ON incoming_signals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_incoming_signals_triage_status ON incoming_signals(triage_status);

-- ============================================================================
-- SKILLS & ROUTINES TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  command VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  description TEXT,
  model VARCHAR(50) DEFAULT 'claude-3.5-sonnet',
  effort_level VARCHAR(50) DEFAULT 'medium',
  is_builtin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, command)
);

CREATE INDEX IF NOT EXISTS idx_skills_tenant_id ON skills(tenant_id);

-- Skill run execution history
CREATE TABLE IF NOT EXISTS skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_id UUID,
  command VARCHAR(255),
  status VARCHAR(50),
  result_artifact_id UUID,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, skill_id) REFERENCES skills(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, result_artifact_id) REFERENCES artifacts(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_tenant_id ON skill_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_skill_runs_status ON skill_runs(status);

-- Routines (scheduled workflows)
CREATE TABLE IF NOT EXISTS routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  schedule VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_routines_tenant_id ON routines(tenant_id);

-- Routine execution history
CREATE TABLE IF NOT EXISTS routine_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL,
  status VARCHAR(50),
  triggered_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  result_artifact_id UUID,
  error_message TEXT,
  FOREIGN KEY (tenant_id, routine_id) REFERENCES routines(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, result_artifact_id) REFERENCES artifacts(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_routine_runs_tenant_id ON routine_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_routine_runs_routine_id ON routine_runs(routine_id);
CREATE INDEX IF NOT EXISTS idx_routine_runs_triggered_at ON routine_runs(triggered_at);

-- ============================================================================
-- SECOND BRAIN / GRAPH TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_type VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entity_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, node_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_tenant_id ON graph_nodes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_node_type ON graph_nodes(node_type);

-- Graph links (edges between nodes)
CREATE TABLE IF NOT EXISTS graph_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL,
  target_node_id UUID NOT NULL,
  link_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, source_node_id) REFERENCES graph_nodes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, target_node_id) REFERENCES graph_nodes(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, source_node_id, target_node_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_graph_links_tenant_id ON graph_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_links_source_node_id ON graph_links(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_links_target_node_id ON graph_links(target_node_id);

-- ============================================================================
-- HANDOFFS & SESSION STATE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  session_date DATE,
  repo_context VARCHAR(255),
  current_branch VARCHAR(255),
  changed_files JSONB,
  work_items_summary TEXT,
  artifacts_summary TEXT,
  decisions JSONB,
  blockers TEXT,
  next_actions TEXT,
  is_draft BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  finalized_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_handoffs_tenant_id ON handoffs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_session_date ON handoffs(session_date);

-- ============================================================================
-- EMAIL INTEGRATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_message_id VARCHAR(255),
  sender VARCHAR(255),
  subject VARCHAR(255),
  body TEXT,
  received_at TIMESTAMP,
  is_processed BOOLEAN DEFAULT FALSE,
  related_work_item UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, related_work_item) REFERENCES work_items(tenant_id, id) ON DELETE SET NULL,
  UNIQUE (tenant_id, email_message_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_tenant_id ON emails(tenant_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);

-- ============================================================================
-- FOCUS BOARD TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS focus_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_item_id UUID,
  artifact_id UUID,
  category VARCHAR(50),
  position INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, artifact_id) REFERENCES artifacts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_focus_board_items_tenant_id ON focus_board_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_focus_board_items_category ON focus_board_items(category);

-- ============================================================================
-- Migration tracking table (optional, for schema version management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001-init') ON CONFLICT DO NOTHING;
