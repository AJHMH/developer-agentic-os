import { randomUUID } from "node:crypto";
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
      `SELECT organizations.clerk_org_id AS tenant_id, vercel_project_id AS project_id,
        vercel_team_id AS team_id, webhook_secret_reference, previous_webhook_secret_reference,
        previous_webhook_secret_expires_at
       FROM vercel_projects
       JOIN organizations ON organizations.id = vercel_projects.tenant_id
       WHERE vercel_project_id = $1`,
      [projectId]
    );
    const matchingRows = teamId
      ? result.rows.filter((row) => row.team_id === teamId).length === 1
        ? result.rows.filter((row) => row.team_id === teamId)
        : result.rows.filter((row) => row.team_id === null)
      : result.rows;
    if (matchingRows.length !== 1) return null;
    const row = matchingRows[0];
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
    const tenantId = await this.tenantDatabaseId(event.tenantId);
    const result = await this.pool.query(
      `INSERT INTO vercel_webhook_events
        (tenant_id, vercel_project_id, vercel_deployment_id, event_type, delivery_id, status, url, commit_sha, payload, raw_expires_at, occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
      ON CONFLICT DO NOTHING`,
      [
        tenantId,
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
    const tenantId = await this.tenantDatabaseId(event.tenantId);
    await this.pool.query(
      `INSERT INTO vercel_deployment_projections
        (tenant_id, vercel_project_id, vercel_deployment_id, event_type, status, url, commit_sha, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (tenant_id, vercel_project_id, vercel_deployment_id) DO UPDATE SET
         event_type = EXCLUDED.event_type,
         status = EXCLUDED.status,
         url = EXCLUDED.url,
         commit_sha = EXCLUDED.commit_sha,
         occurred_at = EXCLUDED.occurred_at
      WHERE EXCLUDED.occurred_at >= vercel_deployment_projections.occurred_at`,
      [
        tenantId,
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
    const tenantId = await this.tenantDatabaseId(event.tenantId);
    await this.pool.query(
      `INSERT INTO vercel_failure_signals
        (tenant_id, vercel_project_id, vercel_deployment_id, source_id, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_id) DO NOTHING`,
      [
        tenantId,
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
    return (this.ready ??= this.pool
      .query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN
         ('organizations', 'vercel_projects', 'vercel_webhook_events',
          'vercel_deployment_projections', 'vercel_failure_signals')
         GROUP BY table_schema HAVING COUNT(*) = 5`
      )
      .then((result) => {
        if (result.rowCount !== 1) throw new Error("Canonical webhook schema is not installed.");
      }));
  }

  private async tenantDatabaseId(clerkOrgId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM organizations WHERE clerk_org_id = $1",
      [clerkOrgId]
    );
    if (result.rows.length === 1) return result.rows[0].id;

    const tenantId = randomUUID();
    const insertResult = await this.pool.query<{ id: string }>(
      `INSERT INTO organizations (id, name, clerk_org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [tenantId, `Organization ${clerkOrgId}`, clerkOrgId]
    );
    return insertResult.rows[0].id;
  }

  async recordAudit(entry: VercelWebhookAuditEntry): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO vercel_webhook_audit (tenant_id, action, vercel_project_id)
       VALUES (
         (SELECT tenant_id
            FROM vercel_projects
           WHERE vercel_project_id = $2
           ORDER BY updated_at DESC
           LIMIT 1),
         $1,
         $2
       )`,
      [entry.action, entry.projectId ?? null]
    );
  }
}
