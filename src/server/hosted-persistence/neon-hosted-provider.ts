import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import { Pool, type PoolClient } from "@neondatabase/serverless";

import type {
  HostedDeploymentState,
  HostedState,
  HostedStateProvider,
  ProtectedSecretStore,
} from "@/server/hosted-domain/hosted-domain-store";
import type {
  HostedWorkspaceState,
  HostedWorkspaceStateProvider,
} from "@/server/hosted-workspaces/hosted-workspace-store";

const schema = `
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
CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_hosted_state_tenant_key ON developer_agentic_os_hosted_state (tenant_id, state_key);
CREATE UNIQUE INDEX IF NOT EXISTS developer_agentic_os_workspace_state_tenant_key ON developer_agentic_os_workspace_state (tenant_id, state_key);`;
const deploymentSchema = `
CREATE TABLE IF NOT EXISTS developer_agentic_os_vercel_project_mapping (
  tenant_id text PRIMARY KEY,
  project_id text NOT NULL,
  team_id text,
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
);`;

const emptyHostedState = (): HostedState => ({
  repositories: {},
  records: {},
  relationships: {},
  snapshots: {},
  connectors: [],
  credentials: [],
  audit: [],
  vercelProject: null,
  vercelProjectHistory: [],
  githubRepositories: [],
});
const emptyWorkspaceState = (): HostedWorkspaceState => ({ users: {}, audit: [] });

export function hostedDatabaseUrl(): string {
  const url =
    process.env.DEV_AGENTIC_OS_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL_UNPOOLED;
  if (!url)
    throw new Error(
      "Hosted persistence requires DATABASE_URL, DATABASE_URL_UNPOOLED, DEV_AGENTIC_OS_DATABASE_URL, or DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED."
    );
  return url;
}

export async function findHostedTenantForGitHubRepository(
  owner: string,
  repository: string
): Promise<string | null> {
  const pool = new Pool({ connectionString: hostedDatabaseUrl() });
  try {
    const result = await pool.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM developer_agentic_os_github_repository_registration WHERE lower(owner) = lower($1) AND lower(repository) = lower($2) LIMIT 1",
      [owner, repository]
    );
    return result.rows[0]?.tenant_id ?? null;
  } finally {
    await pool.end();
  }
}

export class NeonHostedStateProvider implements HostedStateProvider {
  private readonly pool = new Pool({ connectionString: hostedDatabaseUrl() });
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private ready: Promise<void> | undefined;

  constructor(private readonly tenantId: string) {
    if (!tenantId.trim()) throw new Error("Hosted persistence requires a tenant ID.");
  }

  async read(): Promise<HostedState> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore() ?? this.pool;
    const result = await client.query<{ state: HostedState }>(
      "SELECT state FROM developer_agentic_os_hosted_state WHERE tenant_id = $1 AND state_key = $2",
      [this.tenantId, "default"]
    );
    return result.rows[0]?.state ?? emptyHostedState();
  }
  async write(state: HostedState): Promise<void> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.write(state));
    await client.query(
      "INSERT INTO developer_agentic_os_hosted_state (tenant_id, state_key, state) VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id, state_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()",
      [this.tenantId, "default", JSON.stringify(state)]
    );
  }
  async readDeploymentState(): Promise<HostedDeploymentState> {
    await this.ensureDeploymentSchema();
    const client = this.transactionClient.getStore() ?? this.pool;
    const mapping = await client.query<{
      project_id: string;
      team_id: string | null;
      updated_at: string;
    }>(
      "SELECT project_id, team_id, updated_at FROM developer_agentic_os_vercel_project_mapping WHERE tenant_id = $1",
      [this.tenantId]
    );
    const history = await client.query<{
      project_id: string;
      team_id: string | null;
      updated_at: string;
    }>(
      "SELECT project_id, team_id, updated_at FROM developer_agentic_os_vercel_project_history WHERE tenant_id = $1 ORDER BY updated_at",
      [this.tenantId]
    );
    const repositories = await client.query<{
      id: string;
      owner: string;
      repository: string;
      workflow: string;
      ref: string;
      created_at: string;
    }>(
      "SELECT id, owner, repository, workflow, ref, created_at FROM developer_agentic_os_github_repository_registration WHERE tenant_id = $1",
      [this.tenantId]
    );
    return {
      vercelProject: mapping.rows[0]
        ? {
            projectId: mapping.rows[0].project_id,
            ...(mapping.rows[0].team_id ? { teamId: mapping.rows[0].team_id } : {}),
            updatedAt: mapping.rows[0].updated_at,
          }
        : null,
      vercelProjectHistory: history.rows.map((item) => ({
        projectId: item.project_id,
        ...(item.team_id ? { teamId: item.team_id } : {}),
        updatedAt: item.updated_at,
      })),
      githubRepositories: repositories.rows.map((repository) => ({
        id: repository.id,
        tenantId: this.tenantId,
        owner: repository.owner,
        repository: repository.repository,
        workflow: repository.workflow,
        ref: repository.ref,
        createdAt: repository.created_at,
      })),
    };
  }
  async writeDeploymentState(state: HostedDeploymentState): Promise<void> {
    await this.ensureDeploymentSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.writeDeploymentState(state));
    await client.query(
      "DELETE FROM developer_agentic_os_vercel_project_mapping WHERE tenant_id = $1",
      [this.tenantId]
    );
    if (state.vercelProject)
      await client.query(
        "INSERT INTO developer_agentic_os_vercel_project_mapping (tenant_id, project_id, team_id, updated_at) VALUES ($1, $2, $3, $4)",
        [
          this.tenantId,
          state.vercelProject.projectId,
          state.vercelProject.teamId ?? null,
          state.vercelProject.updatedAt,
        ]
      );
    await client.query(
      "DELETE FROM developer_agentic_os_vercel_project_history WHERE tenant_id = $1",
      [this.tenantId]
    );
    for (const historical of state.vercelProjectHistory)
      await client.query(
        "INSERT INTO developer_agentic_os_vercel_project_history (tenant_id, project_id, team_id, updated_at) VALUES ($1, $2, $3, $4)",
        [this.tenantId, historical.projectId, historical.teamId ?? null, historical.updatedAt]
      );
    await client.query(
      "DELETE FROM developer_agentic_os_github_repository_registration WHERE tenant_id = $1",
      [this.tenantId]
    );
    for (const repository of state.githubRepositories)
      await client.query(
        "INSERT INTO developer_agentic_os_github_repository_registration (id, tenant_id, owner, repository, workflow, ref, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          repository.id,
          this.tenantId,
          repository.owner,
          repository.repository,
          repository.workflow,
          repository.ref,
          repository.createdAt,
        ]
      );
  }
  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `developer_agentic_os_hosted_state:${this.tenantId}`,
      ]);
      const result = await this.transactionClient.run(client, operation);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private ensureSchema(): Promise<void> {
    return (this.ready ??= this.pool.query(schema).then(() => undefined));
  }
  private ensureDeploymentSchema(): Promise<void> {
    return this.pool.query(deploymentSchema).then(() => undefined);
  }
}

export class NeonHostedWorkspaceStateProvider implements HostedWorkspaceStateProvider {
  private readonly pool = new Pool({ connectionString: hostedDatabaseUrl() });
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private ready: Promise<void> | undefined;

  constructor(private readonly tenantId: string) {
    if (!tenantId.trim()) throw new Error("Hosted persistence requires a tenant ID.");
  }

  async read(): Promise<HostedWorkspaceState> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore() ?? this.pool;
    const result = await client.query<{ state: HostedWorkspaceState }>(
      "SELECT state FROM developer_agentic_os_workspace_state WHERE tenant_id = $1 AND state_key = $2",
      [this.tenantId, "default"]
    );
    return result.rows[0]?.state ?? emptyWorkspaceState();
  }
  async write(state: HostedWorkspaceState): Promise<void> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.write(state));
    await client.query(
      "INSERT INTO developer_agentic_os_workspace_state (tenant_id, state_key, state) VALUES ($1, $2, $3::jsonb) ON CONFLICT (tenant_id, state_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()",
      [this.tenantId, "default", JSON.stringify(state)]
    );
  }
  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `developer_agentic_os_workspace_state:${this.tenantId}`,
      ]);
      const result = await this.transactionClient.run(client, operation);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private ensureSchema(): Promise<void> {
    return (this.ready ??= this.pool.query(schema).then(() => undefined));
  }
}

export class EncryptedProtectedSecretStore implements ProtectedSecretStore {
  private readonly key = this.loadKey();

  async put(secret: string): Promise<string> {
    if (!secret) throw new Error("Credential secret is required.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return `encrypted-secret:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decrypt(reference: string): string {
    const [, version, ivValue, tagValue, ciphertextValue] = reference.split(":");
    if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue)
      throw new Error("Invalid protected secret reference.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private loadKey(): Buffer {
    const value = process.env.DEV_AGENTIC_OS_SECRET_KEY;
    if (!value) throw new Error("Credential mutations require DEV_AGENTIC_OS_SECRET_KEY.");
    const key = Buffer.from(value, "base64url");
    if (key.length !== 32)
      throw new Error("DEV_AGENTIC_OS_SECRET_KEY must be a base64url-encoded 32-byte key.");
    return key;
  }
}

export function isHostedNeonConfigured(): boolean {
  return Boolean(
    process.env.DEV_AGENTIC_OS_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.DEV_AGENTIC_OS_DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL_UNPOOLED
  );
}

export function isHostedJsonFixtureMode(): boolean {
  return (
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    process.env.HOSTED_JSON_FIXTURE_MODE === "true"
  );
}
