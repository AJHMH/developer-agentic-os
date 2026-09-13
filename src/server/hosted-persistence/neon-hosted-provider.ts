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
    const result = await pool.query<{ clerk_org_id: string }>(
      `SELECT organizations.clerk_org_id
       FROM repos
       JOIN organizations ON organizations.id = repos.tenant_id
       WHERE lower(repos.github_owner) = lower($1)
         AND lower(repos.github_repo) = lower($2)
         AND repos.deployment_workflow IS NOT NULL`,
      [owner, repository]
    );
    return result.rows.length === 1 ? result.rows[0].clerk_org_id : null;
  } finally {
    await pool.end();
  }
}

export class NeonHostedStateProvider implements HostedStateProvider {
  private readonly pool = new Pool({ connectionString: hostedDatabaseUrl() });
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private ready: Promise<void> | undefined;
  private deploymentReady: Promise<void> | undefined;

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
      vercel_project_id: string;
      vercel_team_id: string | null;
      updated_at: string;
    }>(
      `SELECT vercel_project_id, vercel_team_id, updated_at
       FROM vercel_projects
       JOIN organizations ON organizations.id = vercel_projects.tenant_id
       WHERE organizations.clerk_org_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [this.tenantId]
    );
    const history = await client.query<{
      vercel_project_id: string;
      vercel_team_id: string | null;
      changed_at: string;
    }>(
      `SELECT vercel_project_id, vercel_team_id, changed_at
       FROM vercel_project_history
       JOIN organizations ON organizations.id = vercel_project_history.tenant_id
       WHERE organizations.clerk_org_id = $1 ORDER BY changed_at`,
      [this.tenantId]
    );
    const repositories = await client.query<{
      id: string;
      github_owner: string;
      github_repo: string;
      deployment_workflow: string;
      deployment_ref: string;
      created_at: string;
    }>(
      `SELECT repos.id, repos.github_owner, repos.github_repo,
              repos.deployment_workflow, repos.deployment_ref, repos.created_at
       FROM repos
       JOIN organizations ON organizations.id = repos.tenant_id
       WHERE organizations.clerk_org_id = $1 AND repos.deployment_workflow IS NOT NULL`,
      [this.tenantId]
    );
    return {
      vercelProject: mapping.rows[0]
        ? {
            projectId: mapping.rows[0].vercel_project_id,
            ...(mapping.rows[0].vercel_team_id ? { teamId: mapping.rows[0].vercel_team_id } : {}),
            updatedAt: mapping.rows[0].updated_at,
          }
        : null,
      vercelProjectHistory: history.rows.map((item) => ({
        projectId: item.vercel_project_id,
        ...(item.vercel_team_id ? { teamId: item.vercel_team_id } : {}),
        updatedAt: item.changed_at,
      })),
      githubRepositories: repositories.rows.map((repository) => ({
        id: repository.id,
        tenantId: this.tenantId,
        owner: repository.github_owner,
        repository: repository.github_repo,
        workflow: repository.deployment_workflow,
        ref: repository.deployment_ref,
        createdAt: repository.created_at,
      })),
    };
  }
  async writeDeploymentState(state: HostedDeploymentState): Promise<void> {
    await this.ensureDeploymentSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.writeDeploymentState(state));
    const tenant = await client.query<{ id: string }>(
      "SELECT id FROM organizations WHERE clerk_org_id = $1",
      [this.tenantId]
    );
    if (tenant.rows.length !== 1) throw new Error(`Tenant ${this.tenantId} is not registered.`);
    const tenantId = tenant.rows[0].id;
    await client.query("DELETE FROM vercel_projects WHERE tenant_id = $1", [tenantId]);
    if (state.vercelProject) {
      await client.query(
        `INSERT INTO vercel_projects (tenant_id, vercel_project_id, vercel_team_id, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [
          tenantId,
          state.vercelProject.projectId,
          state.vercelProject.teamId ?? null,
          state.vercelProject.updatedAt,
        ]
      );
    }
    await client.query(
      "DELETE FROM vercel_project_history WHERE tenant_id = $1",
      [tenantId]
    );
    for (const historical of state.vercelProjectHistory)
      await client.query(
        "INSERT INTO vercel_project_history (tenant_id, vercel_project_id, vercel_team_id, changed_at) VALUES ($1, $2, $3, $4)",
        [tenantId, historical.projectId, historical.teamId ?? null, historical.updatedAt]
      );
    await client.query(
      "DELETE FROM repos WHERE tenant_id = $1 AND deployment_workflow IS NOT NULL",
      [tenantId]
    );
    for (const repository of state.githubRepositories)
      await client.query(
        `INSERT INTO repos (id, tenant_id, github_owner, github_repo, deployment_workflow, deployment_ref, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (tenant_id, github_owner, github_repo) DO UPDATE SET
            deployment_workflow = EXCLUDED.deployment_workflow,
            deployment_ref = EXCLUDED.deployment_ref,
            updated_at = EXCLUDED.updated_at`,
        [
          repository.id,
          tenantId,
          repository.owner,
          repository.repository,
          repository.workflow,
          repository.ref,
          repository.createdAt,
        ]
      );
  }
  async rotateVercelWebhookSecret(input: {
    projectId: string;
    activeReference: string;
  }): Promise<void> {
    await this.ensureDeploymentSchema();
    const client = this.transactionClient.getStore() ?? this.pool;
    await client.query(
      `UPDATE vercel_projects SET previous_webhook_secret_reference = webhook_secret_reference,
       previous_webhook_secret_expires_at = now() + interval '15 minutes',
       webhook_secret_reference = $1, updated_at = now()
       WHERE tenant_id = (SELECT id FROM organizations WHERE clerk_org_id = $2)
         AND vercel_project_id = $3`,
      [input.activeReference, this.tenantId, input.projectId]
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
    return (this.deploymentReady ??= this.pool
      .query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN
         ('organizations', 'repos', 'vercel_projects', 'vercel_project_history')
         GROUP BY table_schema HAVING COUNT(*) = 4`
      )
      .then((result) => {
        if (result.rowCount !== 1) throw new Error("Canonical deployment schema is not installed.");
      }));
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
