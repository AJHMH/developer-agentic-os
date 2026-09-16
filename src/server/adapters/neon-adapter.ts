/**
 * Neon PostgreSQL Data Adapter
 *
 * Replaces local JSON file storage with Neon PostgreSQL for multi-tenant data access.
 * Every query includes tenant_id filtering for row-level isolation.
 *
 * Usage:
 *   const adapter = new NeonAdapter(databaseUrl, tenantId);
 *   const artifacts = await adapter.listArtifacts();
 */

import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

export interface NeonAdapterConfig {
  databaseUrl: string;
  tenantId: string;
}

export class NeonAdapter {
  private pool: Pool;
  private tenantId: string;

  constructor(config: NeonAdapterConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
    this.tenantId = config.tenantId;
  }

  private async getClient() {
    return this.pool.connect();
  }

  // ============================================================================
  // ARTIFACTS
  // ============================================================================

  async listArtifacts(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM artifacts 
         WHERE tenant_id = $1 
         ORDER BY created_at DESC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getArtifact(id: string): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM artifacts 
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async createArtifact(artifact: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = (artifact.id as string) || randomUUID();
      const result = await client.query(
        `INSERT INTO artifacts (id, tenant_id, type, title, content, created_at, updated_at, is_draft, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          artifact.type || "artifact",
          artifact.title || "Untitled",
          artifact.content || "",
          artifact.created_at || new Date(),
          artifact.updated_at || new Date(),
          artifact.is_draft ?? false,
          artifact.tags ? JSON.stringify(artifact.tags) : null,
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async updateArtifact(
    id: string,
    artifact: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const updates: string[] = [];
      const values: unknown[] = [this.tenantId, id];
      let paramCount = 2;

      if (artifact.title !== undefined) {
        updates.push(`title = $${++paramCount}`);
        values.push(artifact.title);
      }
      if (artifact.content !== undefined) {
        updates.push(`content = $${++paramCount}`);
        values.push(artifact.content);
      }
      if (artifact.type !== undefined) {
        updates.push(`type = $${++paramCount}`);
        values.push(artifact.type);
      }
      if (artifact.is_draft !== undefined) {
        updates.push(`is_draft = $${++paramCount}`);
        values.push(artifact.is_draft);
      }
      if (artifact.tags !== undefined) {
        updates.push(`tags = $${++paramCount}`);
        values.push(artifact.tags ? JSON.stringify(artifact.tags) : null);
      }

      updates.push(`updated_at = $${++paramCount}`);
      values.push(new Date());

      const result = await client.query(
        `UPDATE artifacts 
         SET ${updates.join(", ")} 
         WHERE tenant_id = $1 AND id = $2 
         RETURNING *`,
        values
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `DELETE FROM artifacts 
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id]
      );
      return result.rowCount! > 0;
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // WORK ITEMS
  // ============================================================================

  async listWorkItems(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM work_items 
         WHERE tenant_id = $1 
         ORDER BY created_at DESC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getWorkItem(id: string): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM work_items 
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async createWorkItem(workItem: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = (workItem.id as string) || randomUUID();
      const result = await client.query(
        `INSERT INTO work_items (id, tenant_id, title, description, status, priority, due_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          workItem.title || "Untitled",
          workItem.description || "",
          workItem.status || "open",
          workItem.priority || "medium",
          workItem.due_date || null,
          workItem.created_at || new Date(),
          workItem.updated_at || new Date(),
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  async updateWorkItem(
    id: string,
    workItem: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const updates: string[] = [];
      const values: unknown[] = [this.tenantId, id];
      let paramCount = 2;

      if (workItem.title !== undefined) {
        updates.push(`title = $${++paramCount}`);
        values.push(workItem.title);
      }
      if (workItem.description !== undefined) {
        updates.push(`description = $${++paramCount}`);
        values.push(workItem.description);
      }
      if (workItem.status !== undefined) {
        updates.push(`status = $${++paramCount}`);
        values.push(workItem.status);
      }
      if (workItem.priority !== undefined) {
        updates.push(`priority = $${++paramCount}`);
        values.push(workItem.priority);
      }
      if (workItem.due_date !== undefined) {
        updates.push(`due_date = $${++paramCount}`);
        values.push(workItem.due_date);
      }

      updates.push(`updated_at = $${++paramCount}`);
      values.push(new Date());

      const result = await client.query(
        `UPDATE work_items 
         SET ${updates.join(", ")} 
         WHERE tenant_id = $1 AND id = $2 
         RETURNING *`,
        values
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async deleteWorkItem(id: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `DELETE FROM work_items 
         WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id]
      );
      return result.rowCount! > 0;
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // SKILLS
  // ============================================================================

  async listSkills(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM skills 
         WHERE tenant_id = $1 AND is_active = true 
         ORDER BY command ASC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getSkill(command: string): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM skills 
         WHERE tenant_id = $1 AND command = $2`,
        [this.tenantId, command]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async createSkill(skill: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO skills (id, tenant_id, command, display_name, description, model, effort_level, is_builtin, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          id,
          this.tenantId,
          skill.command || "",
          skill.display_name || skill.command || "Skill",
          skill.description || "",
          skill.model || "claude-3.5-sonnet",
          skill.effort_level || "medium",
          skill.is_builtin ?? false,
          skill.is_active ?? true,
          skill.created_at || new Date(),
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // ROUTINES
  // ============================================================================

  async listRoutines(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM routines 
         WHERE tenant_id = $1 
         ORDER BY name ASC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getRoutine(name: string): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM routines 
         WHERE tenant_id = $1 AND name = $2`,
        [this.tenantId, name]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async createRoutine(routine: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO routines (id, tenant_id, name, description, schedule, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          this.tenantId,
          routine.name || "Routine",
          routine.description || "",
          routine.schedule || "",
          routine.is_active ?? true,
          routine.created_at || new Date(),
          routine.updated_at || new Date(),
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // REPOS
  // ============================================================================

  async listRepos(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM repos 
         WHERE tenant_id = $1 AND is_active = true 
         ORDER BY github_repo ASC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getRepo(githubOwner: string, githubRepo: string): Promise<Record<string, unknown> | null> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM repos 
         WHERE tenant_id = $1 AND github_owner = $2 AND github_repo = $3`,
        [this.tenantId, githubOwner, githubRepo]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async createRepo(repo: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO repos (id, tenant_id, github_owner, github_repo, github_url, default_branch, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          repo.github_owner || "",
          repo.github_repo || "",
          repo.github_url || "",
          repo.default_branch || "main",
          repo.is_active ?? true,
          repo.created_at || new Date(),
          repo.updated_at || new Date(),
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // INCOMING SIGNALS
  // ============================================================================

  async listSignals(): Promise<Record<string, unknown>[]> {
    const client = await this.getClient();
    try {
      const result = await client.query(
        `SELECT * FROM incoming_signals 
         WHERE tenant_id = $1 
         ORDER BY created_at DESC`,
        [this.tenantId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  async createSignal(signal: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.getClient();
    try {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO incoming_signals (id, tenant_id, source_type, source_id, title, body, triage_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          signal.source_type || "manual",
          signal.source_id || randomUUID(),
          signal.title || "Signal",
          signal.body || "",
          signal.triage_status || "new",
          signal.created_at || new Date(),
          signal.updated_at || new Date(),
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  async close(): Promise<void> {
    await this.pool.end();
  }

  async health(): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      client.release();
    }
  }
}

// Export singleton instance factory for use in application
export function createNeonAdapter(config: NeonAdapterConfig): NeonAdapter {
  return new NeonAdapter(config);
}
