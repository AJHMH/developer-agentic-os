import { createHash } from "node:crypto";
import { Pool } from "@neondatabase/serverless";

import {
  canonicalHostedStateTables,
  provisionCanonicalHostedSchema,
} from "@/server/hosted-persistence/canonical-hosted-schema";
import {
  hostedDatabaseUrl,
  resolveHostedTenantDatabaseId,
} from "@/server/hosted-persistence/neon-hosted-provider";
import type { HostedObjectStore } from "./hosted-object-store";
import { HostedDomainError } from "./hosted-domain-store";

export class NeonHostedObjectStore implements HostedObjectStore {
  private pool: Pool | null = null;
  private ready: Promise<void> | undefined;

  constructor(
    private readonly tenantId: string,
    pool?: Pool
  ) {
    if (!tenantId.trim()) throw new Error("Hosted persistence requires a tenant ID.");
    if (pool) {
      this.pool = pool;
    }
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ connectionString: hostedDatabaseUrl() });
    }
    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      const pool = this.getPool();
      this.ready = provisionCanonicalHostedSchema(pool, canonicalHostedStateTables);
    }
    return this.ready;
  }

  async put(
    content: string | Uint8Array,
    contentType: string
  ): Promise<{ reference: string; contentType: string; size: number }> {
    await this.ensureSchema();
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const reference = createHash("sha256").update(bytes).digest("hex");
    const pool = this.getPool();
    const dbTenantId = await resolveHostedTenantDatabaseId(pool, this.tenantId);

    await pool.query(
      `INSERT INTO hosted_objects (reference, tenant_id, content_type, size, data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (tenant_id, reference) DO NOTHING`,
      [reference, dbTenantId, contentType, bytes.byteLength, bytes]
    );

    return { reference, contentType, size: bytes.byteLength };
  }

  async get(reference: string): Promise<Uint8Array> {
    if (
      typeof reference !== "string" ||
      reference.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(reference)
    ) {
      throw new HostedDomainError("INVALID", "Invalid object reference.");
    }
    await this.ensureSchema();
    const pool = this.getPool();
    const dbTenantId = await resolveHostedTenantDatabaseId(pool, this.tenantId);

    const result = await pool.query<{ data: Buffer | Uint8Array }>(
      `SELECT data FROM hosted_objects WHERE tenant_id = $1 AND reference = $2`,
      [dbTenantId, reference]
    );

    if (result.rows.length === 0) {
      throw new HostedDomainError("NOT_FOUND", "Object not found.");
    }

    const row = result.rows[0];
    return row.data instanceof Uint8Array ? row.data : Buffer.from(row.data);
  }
}
