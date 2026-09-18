import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import WebSocket from "ws";

import {
  assertHostedProductionPersistenceConfigured,
  canonicalHostedDeploymentTables,
  canonicalHostedStateTables,
  provisionCanonicalHostedSchema,
} from "./canonical-hosted-schema";
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

neonConfig.webSocketConstructor = WebSocket;

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

type HostedStateRepositoryRow = {
  id: string;
  workspace_id: string;
  local_path: string;
  path_identity: string;
  created_at: string;
};

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
    await provisionCanonicalHostedSchema(pool, canonicalHostedDeploymentTables);
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
    const tenantId = await this.tenantDatabaseId(client);
    const state = emptyHostedState();
    const repositories = await client.query<HostedStateRepositoryRow>(
      "SELECT id, workspace_id, local_path, path_identity, created_at FROM hosted_repositories WHERE tenant_id = $1",
      [tenantId]
    );
    for (const repository of repositories.rows) {
      (state.repositories[repository.workspace_id] ??= []).push({
        id: repository.id,
        localPath: repository.local_path,
        pathIdentity: repository.path_identity,
        createdAt: repository.created_at,
      });
    }
    const records = await client.query<{
      workspace_id: string;
      kind: string;
      value: Record<string, unknown>;
    }>("SELECT workspace_id, kind, value FROM hosted_records WHERE tenant_id = $1", [tenantId]);
    for (const record of records.rows) {
      const workspace = (state.records[record.workspace_id] ??= {});
      (workspace[record.kind as keyof typeof workspace] ??= []).push(record.value);
    }
    const relationships = await client.query<{
      workspace_id: string;
      source_id: string;
      target_id: string;
      kind: string;
    }>(
      "SELECT workspace_id, source_id, target_id, kind FROM hosted_relationships WHERE tenant_id = $1",
      [tenantId]
    );
    for (const relationship of relationships.rows)
      (state.relationships[relationship.workspace_id] ??= []).push({
        from: relationship.source_id,
        to: relationship.target_id,
        kind: relationship.kind,
      });
    const snapshots = await client.query<{
      workspace_id: string;
      value: HostedState["snapshots"][string][number];
    }>("SELECT workspace_id, value FROM hosted_snapshots WHERE tenant_id = $1", [tenantId]);
    for (const snapshot of snapshots.rows)
      (state.snapshots[snapshot.workspace_id] ??= []).push(snapshot.value);
    const connectors = await client.query<{ value: HostedState["connectors"][number] }>(
      "SELECT value FROM hosted_connectors WHERE tenant_id = $1",
      [tenantId]
    );
    state.connectors = connectors.rows.map((row) => row.value);
    const credentials = await client.query<{ value: HostedState["credentials"][number] }>(
      "SELECT value FROM hosted_credentials WHERE tenant_id = $1",
      [tenantId]
    );
    state.credentials = credentials.rows.map((row) => row.value);
    const audit = await client.query<{ value: HostedState["audit"][number] }>(
      "SELECT value FROM hosted_audit WHERE tenant_id = $1",
      [tenantId]
    );
    state.audit = audit.rows.map((row) => row.value);
    return state;
  }
  async write(state: HostedState): Promise<void> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.write(state));
    const tenantId = await this.tenantDatabaseId(client);
    for (const table of [
      "hosted_repositories",
      "hosted_records",
      "hosted_relationships",
      "hosted_snapshots",
      "hosted_connectors",
      "hosted_credentials",
      "hosted_audit",
    ])
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    for (const [workspaceId, repositories] of Object.entries(state.repositories))
      for (const repository of repositories)
        await client.query(
          "INSERT INTO hosted_repositories (id, tenant_id, workspace_id, local_path, path_identity, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            repository.id,
            tenantId,
            workspaceId,
            repository.localPath,
            repository.pathIdentity,
            repository.createdAt,
          ]
        );
    for (const [workspaceId, recordMap] of Object.entries(state.records))
      for (const [kind, records] of Object.entries(recordMap))
        for (const record of records ?? [])
          await client.query(
            "INSERT INTO hosted_records (id, tenant_id, workspace_id, kind, value) VALUES ($1, $2, $3, $4, $5::jsonb)",
            [
              typeof record.id === "string" ? record.id : randomUUID(),
              tenantId,
              workspaceId,
              kind,
              JSON.stringify(record),
            ]
          );
    for (const [workspaceId, links] of Object.entries(state.relationships))
      for (const link of links)
        await client.query(
          "INSERT INTO hosted_relationships (tenant_id, workspace_id, source_id, target_id, kind) VALUES ($1, $2, $3, $4, $5)",
          [tenantId, workspaceId, link.from, link.to, link.kind]
        );
    for (const [workspaceId, snapshots] of Object.entries(state.snapshots))
      for (const snapshot of snapshots)
        await client.query(
          "INSERT INTO hosted_snapshots (id, tenant_id, workspace_id, value) VALUES ($1, $2, $3, $4::jsonb)",
          [snapshot.id, tenantId, workspaceId, JSON.stringify(snapshot)]
        );
    for (const connector of state.connectors)
      await client.query(
        "INSERT INTO hosted_connectors (id, tenant_id, workspace_id, value) VALUES ($1, $2, $3, $4::jsonb)",
        [connector.id, tenantId, connector.workspaceId, JSON.stringify(connector)]
      );
    for (const credential of state.credentials)
      await client.query(
        "INSERT INTO hosted_credentials (id, tenant_id, workspace_id, value) VALUES ($1, $2, $3, $4::jsonb)",
        [credential.id, tenantId, credential.workspaceId, JSON.stringify(credential)]
      );
    for (const event of state.audit)
      await client.query(
        "INSERT INTO hosted_audit (id, tenant_id, workspace_id, value) VALUES ($1, $2, $3, $4::jsonb)",
        [event.id, tenantId, event.workspaceId ?? null, JSON.stringify(event)]
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
    const tenantId = await this.tenantDatabaseId(client);
    const activeProjectId = state.vercelProject?.projectId ?? null;
    if (state.vercelProject) {
      await client.query(
        `INSERT INTO vercel_projects (tenant_id, vercel_project_id, vercel_team_id, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, vercel_project_id) DO UPDATE SET
           vercel_team_id = EXCLUDED.vercel_team_id,
           updated_at = EXCLUDED.updated_at`,
        [
          tenantId,
          state.vercelProject.projectId,
          state.vercelProject.teamId ?? null,
          state.vercelProject.updatedAt,
        ]
      );
    }
    await client.query(
      `DELETE FROM vercel_projects
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR vercel_project_id <> $2)`,
      [tenantId, activeProjectId]
    );
    await client.query("DELETE FROM vercel_project_history WHERE tenant_id = $1", [tenantId]);
    for (const historical of state.vercelProjectHistory)
      await client.query(
        "INSERT INTO vercel_project_history (tenant_id, vercel_project_id, vercel_team_id, changed_at) VALUES ($1, $2, $3, $4)",
        [tenantId, historical.projectId, historical.teamId ?? null, historical.updatedAt]
      );
    const existingDeploymentRepos = await client.query<{
      github_owner: string;
      github_repo: string;
    }>(
      "SELECT github_owner, github_repo FROM repos WHERE tenant_id = $1 AND deployment_workflow IS NOT NULL",
      [tenantId]
    );
    const desiredDeploymentRepoKeys = new Set(
      state.githubRepositories.map(
        (repository) => `${repository.owner.toLowerCase()}\0${repository.repository.toLowerCase()}`
      )
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
    for (const existingRepository of existingDeploymentRepos.rows) {
      const repositoryKey = `${existingRepository.github_owner.toLowerCase()}\0${existingRepository.github_repo.toLowerCase()}`;
      if (desiredDeploymentRepoKeys.has(repositoryKey)) continue;
      await client.query(
        `UPDATE repos
         SET deployment_workflow = NULL,
             deployment_ref = NULL,
             updated_at = $4
         WHERE tenant_id = $1
           AND lower(github_owner) = lower($2)
           AND lower(github_repo) = lower($3)
           AND deployment_workflow IS NOT NULL`,
        [
          tenantId,
          existingRepository.github_owner,
          existingRepository.github_repo,
          new Date().toISOString(),
        ]
      );
    }
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
        `hosted_state:${this.tenantId}`,
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
    const ready = this.ready;
    if (ready) return ready;
    const provisioning = provisionCanonicalHostedSchema(
      this.pool,
      canonicalHostedStateTables
    ).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    this.ready = provisioning;
    return provisioning;
  }
  private async tenantDatabaseId(client: Pool | PoolClient): Promise<string> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM organizations WHERE clerk_org_id = $1",
      [this.tenantId]
    );
    if (result.rows.length === 1) return result.rows[0].id;

    const tenantId = randomUUID();
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO organizations (id, name, clerk_org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [tenantId, `Organization ${this.tenantId}`, this.tenantId]
    );
    return insertResult.rows[0].id;
  }
  private ensureDeploymentSchema(): Promise<void> {
    const ready = this.deploymentReady;
    if (ready) return ready;
    const provisioning = provisionCanonicalHostedSchema(
      this.pool,
      canonicalHostedDeploymentTables
    ).catch((error) => {
      this.deploymentReady = undefined;
      throw error;
    });
    this.deploymentReady = provisioning;
    return provisioning;
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
    const tenantId = await this.tenantDatabaseId(client);
    const users = await client.query<{ user_id: string; active_workspace_id: string | null }>(
      "SELECT user_id, active_workspace_id FROM hosted_workspace_users WHERE tenant_id = $1",
      [tenantId]
    );
    const workspaces = await client.query<{
      id: string;
      owner_id: string;
      name: string;
      created_at: string;
    }>("SELECT id, owner_id, name, created_at FROM hosted_workspaces WHERE tenant_id = $1", [
      tenantId,
    ]);
    const state: HostedWorkspaceState = { users: {}, audit: [] };
    for (const user of users.rows)
      state.users[user.user_id] = {
        workspaces: [],
        activeWorkspaceId: user.active_workspace_id,
      };
    for (const workspace of workspaces.rows) {
      const user = (state.users[workspace.owner_id] ??= {
        workspaces: [],
        activeWorkspaceId: null,
      });
      user.workspaces.push({
        id: workspace.id,
        ownerId: workspace.owner_id,
        name: workspace.name,
        createdAt: workspace.created_at,
      });
    }
    const audit = await client.query<{
      id: string;
      user_id: string;
      workspace_id: string | null;
      action: string;
      occurred_at: string;
    }>(
      "SELECT id, user_id, workspace_id, action, occurred_at FROM hosted_workspace_audit WHERE tenant_id = $1",
      [tenantId]
    );
    state.audit = audit.rows.map((event) => ({
      id: event.id,
      userId: event.user_id,
      ...(event.workspace_id ? { workspaceId: event.workspace_id } : {}),
      action: event.action as HostedWorkspaceState["audit"][number]["action"],
      occurredAt: event.occurred_at,
    }));
    return state;
  }
  async write(state: HostedWorkspaceState): Promise<void> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.write(state));
    const tenantId = await this.tenantDatabaseId(client);
    await client.query("DELETE FROM hosted_workspace_audit WHERE tenant_id = $1", [tenantId]);
    const desiredWorkspaceIds = new Set<string>();
    for (const user of Object.values(state.users))
      for (const workspace of user.workspaces) desiredWorkspaceIds.add(workspace.id);
    for (const user of Object.values(state.users))
      for (const workspace of user.workspaces)
        await client.query(
          `INSERT INTO hosted_workspaces (id, tenant_id, owner_id, name, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             owner_id = EXCLUDED.owner_id,
             name = EXCLUDED.name,
             created_at = EXCLUDED.created_at`,
          [workspace.id, tenantId, workspace.ownerId, workspace.name, workspace.createdAt]
        );
    const desiredUserIds = Object.keys(state.users);
    for (const [userId, user] of Object.entries(state.users)) {
      const activeWorkspaceId =
        user.activeWorkspaceId && desiredWorkspaceIds.has(user.activeWorkspaceId)
          ? user.activeWorkspaceId
          : null;
      await client.query(
        `INSERT INTO hosted_workspace_users (tenant_id, user_id, active_workspace_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id`,
        [tenantId, userId, activeWorkspaceId]
      );
      for (const workspace of user.workspaces)
        await client.query(
          `INSERT INTO hosted_workspace_members (tenant_id, workspace_id, user_id, active_workspace)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE SET
             active_workspace = EXCLUDED.active_workspace`,
          [tenantId, workspace.id, userId, workspace.id === activeWorkspaceId]
        );
    }
    if (desiredUserIds.length > 0)
      await client.query(
        "DELETE FROM hosted_workspace_users WHERE tenant_id = $1 AND user_id <> ALL($2::text[])",
        [tenantId, desiredUserIds]
      );
    else await client.query("DELETE FROM hosted_workspace_users WHERE tenant_id = $1", [tenantId]);
    if (desiredWorkspaceIds.size > 0)
      await client.query(
        "DELETE FROM hosted_workspaces WHERE tenant_id = $1 AND id <> ALL($2::uuid[])",
        [tenantId, Array.from(desiredWorkspaceIds)]
      );
    else await client.query("DELETE FROM hosted_workspaces WHERE tenant_id = $1", [tenantId]);
    for (const event of state.audit)
      await client.query(
        "INSERT INTO hosted_workspace_audit (id, tenant_id, user_id, workspace_id, action, occurred_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          event.id,
          tenantId,
          event.userId,
          event.workspaceId ?? null,
          event.action,
          event.occurredAt,
        ]
      );
  }
  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `hosted_workspace_state:${this.tenantId}`,
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
    const ready = this.ready;
    if (ready) return ready;
    const provisioning = provisionCanonicalHostedSchema(
      this.pool,
      canonicalHostedStateTables
    ).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    this.ready = provisioning;
    return provisioning;
  }

  private async tenantDatabaseId(client: Pool | PoolClient): Promise<string> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM organizations WHERE clerk_org_id = $1",
      [this.tenantId]
    );
    if (result.rows.length === 1) return result.rows[0].id;

    const tenantId = randomUUID();
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO organizations (id, name, clerk_org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [tenantId, `Organization ${this.tenantId}`, this.tenantId]
    );
    return insertResult.rows[0].id;
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

export { assertHostedProductionPersistenceConfigured };
