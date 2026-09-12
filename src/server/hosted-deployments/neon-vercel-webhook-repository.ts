import { Pool } from "@neondatabase/serverless";

import {
  EncryptedProtectedSecretStore,
  hostedDatabaseUrl,
} from "@/server/hosted-persistence/neon-hosted-provider";
import type {
  VercelWebhookAuditEntry,
  VercelWebhookEvent,
  VercelWebhookProject,
  VercelWebhookRepository,
} from "./vercel-webhook";

const schema = `
CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_project_mapping (
  tenant_id text PRIMARY KEY,
  project_id text NOT NULL,
  team_id text,
  webhook_secret_reference text,
  previous_webhook_secret_reference text,
  previous_webhook_secret_expires_at timestamptz,
  updated_at timestamptz NOT NULL
);
ALTER TABLE developer_agentic_os_vercel_project_mapping ADD COLUMN IF NOT EXISTS webhook_secret_reference text;
ALTER TABLE developer_agentic_os_vercel_project_mapping ADD COLUMN IF NOT EXISTS previous_webhook_secret_reference text;
ALTER TABLE developer_agentic_os_vercel_project_mapping ADD COLUMN IF NOT EXISTS previous_webhook_secret_expires_at timestamptz;
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
CREATE INDEX IF NOT EXISTS developer_agentic_os_vercel_webhook_events_tenant
  ON developer_agentic_os_vercel_webhook_events (tenant_id, received_at);
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
);`;

export class NeonVercelWebhookRepository implements VercelWebhookRepository {
  private readonly pool = new Pool({ connectionString: hostedDatabaseUrl() });
  private readonly secretStore = new EncryptedProtectedSecretStore();
  private ready: Promise<void> | undefined;

  async findProject(projectId: string, teamId?: string): Promise<VercelWebhookProject | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{
      tenant_id: string;
      project_id: string;
      team_id: string | null;
      webhook_secret_reference: string | null;
      previous_webhook_secret_reference: string | null;
      previous_webhook_secret_expires_at: string | null;
    }>(
      `SELECT tenant_id, project_id, team_id, webhook_secret_reference, previous_webhook_secret_reference,
        previous_webhook_secret_expires_at
       FROM developer_agentic_os_vercel_project_mapping
       WHERE project_id = $1 AND (($2::text IS NULL AND team_id IS NULL) OR team_id = $2)
       LIMIT 2`,
      [projectId, teamId ?? null]
    );
    if (result.rows.length !== 1) return null;
    const row = result.rows[0];
    if (!row.webhook_secret_reference) return null;
    return {
      tenantId: row.tenant_id,
      projectId: row.project_id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      secret: this.secretStore.decrypt(row.webhook_secret_reference),
      ...(row.previous_webhook_secret_reference &&
      row.previous_webhook_secret_expires_at &&
      Date.parse(row.previous_webhook_secret_expires_at) > Date.now()
        ? { previousSecret: this.secretStore.decrypt(row.previous_webhook_secret_reference) }
        : {}),
    };
  }

  async recordEvent(event: VercelWebhookEvent): Promise<{ duplicate: boolean }> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `INSERT INTO developer_agentic_os_vercel_webhook_events
        (tenant_id, project_id, deployment_id, event_type, delivery_id, status, url, commit_sha, payload, raw_expires_at, occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
      ON CONFLICT DO NOTHING`,
      [
        event.tenantId,
        event.projectId,
        event.deploymentId,
        event.eventType,
        event.deliveryId ?? null,
        event.status,
        event.url,
        event.commitSha,
        JSON.stringify(event.payload),
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        event.occurredAt,
      ]
    );
    return { duplicate: result.rowCount === 0 };
  }

  async updateProjection(event: VercelWebhookEvent): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO developer_agentic_os_vercel_deployment_projection
        (tenant_id, project_id, deployment_id, event_type, status, url, commit_sha, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, deployment_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         event_type = EXCLUDED.event_type,
         status = EXCLUDED.status,
         url = EXCLUDED.url,
         commit_sha = EXCLUDED.commit_sha,
         occurred_at = EXCLUDED.occurred_at
       WHERE EXCLUDED.occurred_at >= developer_agentic_os_vercel_deployment_projection.occurred_at`,
      [
        event.tenantId,
        event.projectId,
        event.deploymentId,
        event.eventType,
        event.status,
        event.url,
        event.commitSha,
        event.occurredAt,
      ]
    );
  }

  async recordFailureSignal(event: VercelWebhookEvent): Promise<void> {
    await this.ensureSchema();
    const sourceId = `vercel:${event.projectId}:${event.deploymentId}:error`;
    await this.pool.query(
      `INSERT INTO developer_agentic_os_vercel_failure_signals
        (tenant_id, project_id, deployment_id, source_id, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_id) DO NOTHING`,
      [
        event.tenantId,
        event.projectId,
        event.deploymentId,
        sourceId,
        `Vercel deployment ${event.deploymentId} failed`,
        `Deployment ${event.deploymentId} reported an error for project ${event.projectId}.`,
      ]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private ensureSchema(): Promise<void> {
    return (this.ready ??= this.pool.query(schema).then(() => undefined));
  }

  async recordAudit(entry: VercelWebhookAuditEntry): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "INSERT INTO developer_agentic_os_vercel_webhook_audit (action, project_id) VALUES ($1, $2)",
      [entry.action, entry.projectId ?? null]
    );
  }
}