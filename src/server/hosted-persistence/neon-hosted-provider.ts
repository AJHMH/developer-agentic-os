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
  ApprovalStatus,
  HostedAuditEvent,
  HostedWorkspace,
  InvitationStatus,
  ProtectedAction,
  WorkspaceApproval,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspacePolicy,
  WorkspaceRecoveryInfo,
  WorkspaceRole,
  WorkspaceStatus,
} from "@/types/hosted-workspace";
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

type HostedTenantLookupClient = {
  query(queryText: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
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

export function missingHostedTenantProvisioningError(clerkOrgId: string): Error {
  return new Error(
    `Hosted organization ${clerkOrgId} is not provisioned in organizations. Run the canonical Neon migration/provisioning path first.`
  );
}

export async function resolveHostedTenantDatabaseId(
  client: HostedTenantLookupClient,
  clerkOrgId: string
): Promise<string> {
  const result = await client.query(
    "SELECT id FROM organizations WHERE clerk_org_id = $1 LIMIT 2",
    [clerkOrgId]
  );
  if (result.rows.length === 1) return (result.rows[0] as { id: string }).id;
  if (result.rows.length > 1)
    throw new Error(
      `Hosted organization ${clerkOrgId} has duplicate organization mappings. Resolve data integrity before continuing.`
    );
  throw missingHostedTenantProvisioningError(clerkOrgId);
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
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private ready: Promise<void> | undefined;
  private deploymentReady: Promise<void> | undefined;

  constructor(
    private readonly tenantId: string,
    pool?: Pool
  ) {
    if (!tenantId.trim()) throw new Error("Hosted persistence requires a tenant ID.");
    this.pool = pool ?? new Pool({ connectionString: hostedDatabaseUrl() });
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
    const tenantId = await this.tenantDatabaseId(client);
    const mapping = await client.query<{
      vercel_project_id: string;
      vercel_team_id: string | null;
      updated_at: string;
    }>(
      `SELECT vercel_project_id, vercel_team_id, updated_at
       FROM vercel_projects
       WHERE tenant_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId]
    );
    const history = await client.query<{
      vercel_project_id: string;
      vercel_team_id: string | null;
      changed_at: string;
    }>(
      `SELECT vercel_project_id, vercel_team_id, changed_at
       FROM vercel_project_history
       WHERE tenant_id = $1 ORDER BY changed_at`,
      [tenantId]
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
       WHERE tenant_id = $1 AND repos.deployment_workflow IS NOT NULL`,
      [tenantId]
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
    if ("end" in this.pool && typeof this.pool.end === "function") {
      await this.pool.end();
    }
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
    return resolveHostedTenantDatabaseId(client, this.tenantId);
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

function toIsoDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") return val;
  return new Date(String(val)).toISOString();
}

export class NeonHostedWorkspaceStateProvider implements HostedWorkspaceStateProvider {
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  private ready: Promise<void> | undefined;

  constructor(
    private readonly tenantId: string,
    pool?: Pool
  ) {
    if (!tenantId.trim()) throw new Error("Hosted persistence requires a tenant ID.");
    this.pool = pool ?? new Pool({ connectionString: hostedDatabaseUrl() });
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
      status: string | null;
      deleted_at: string | null;
      recovery_backup_id: string | null;
      recovery_info: WorkspaceRecoveryInfo | null;
    }>(
      "SELECT id, owner_id, name, created_at, status, deleted_at, recovery_backup_id, recovery_info FROM hosted_workspaces WHERE tenant_id = $1",
      [tenantId]
    );
    const members = await client.query<{
      workspace_id: string;
      user_id: string;
      role: string;
      joined_at: string;
      active_workspace: boolean;
    }>(
      "SELECT workspace_id, user_id, role, joined_at, active_workspace FROM hosted_workspace_members WHERE tenant_id = $1",
      [tenantId]
    );
    const invitations = await client.query<{
      id: string;
      workspace_id: string;
      recipient_email: string;
      role: string;
      status: string;
      invited_by: string;
      created_at: string;
      expires_at: string;
      accepted_at: string | null;
      accepted_by: string | null;
      revoked_at: string | null;
      revoked_by: string | null;
    }>(
      "SELECT id, workspace_id, recipient_email, role, status, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at, revoked_by FROM hosted_workspace_invitations WHERE tenant_id = $1",
      [tenantId]
    );
    const approvals = await client.query<{
      id: string;
      workspace_id: string;
      actor_id: string;
      action: string;
      target: string;
      version: string;
      reason: string;
      correlation_id: string;
      approved_by: string;
      status: string;
      created_at: string;
      expires_at: string;
      consumed_at: string | null;
      consumed_by: string | null;
      revoked_at: string | null;
      revoked_by: string | null;
    }>(
      "SELECT id, workspace_id, actor_id, action, target, version, reason, correlation_id, approved_by, status, created_at, expires_at, consumed_at, consumed_by, revoked_at, revoked_by FROM hosted_workspace_approvals WHERE tenant_id = $1",
      [tenantId]
    );
    const policies = await client.query<{
      workspace_id: string;
      require_approval_for_delete: boolean;
      require_approval_for_export: boolean;
      require_approval_for_transfer: boolean;
      approval_expiry_window_seconds: number;
      version: number;
      updated_at: string;
      updated_by: string;
    }>(
      "SELECT workspace_id, require_approval_for_delete, require_approval_for_export, require_approval_for_transfer, approval_expiry_window_seconds, version, updated_at, updated_by FROM hosted_workspace_policies WHERE tenant_id = $1",
      [tenantId]
    );

    const state: HostedWorkspaceState = {
      workspaces: {},
      members: {},
      invitations: {},
      approvals: {},
      policies: {},
      users: {},
      audit: [],
    };
    for (const ws of workspaces.rows) {
      state.workspaces![ws.id] = {
        id: ws.id,
        ownerId: ws.owner_id,
        name: ws.name,
        createdAt: ws.created_at,
        status: (ws.status as WorkspaceStatus) ?? "active",
        ...(ws.deleted_at ? { deletedAt: toIsoDate(ws.deleted_at) } : {}),
        ...(ws.recovery_backup_id ? { recoveryBackupId: ws.recovery_backup_id } : {}),
        ...(ws.recovery_info ? { recoveryInfo: ws.recovery_info } : {}),
      };
      state.members![ws.id] = [];
      state.invitations![ws.id] = [];
      state.approvals![ws.id] = [];
    }
    for (const user of users.rows) {
      state.users[user.user_id] = {
        workspaces: [],
        activeWorkspaceId: user.active_workspace_id,
      };
    }
    for (const m of members.rows) {
      const ws = state.workspaces![m.workspace_id];
      if (!ws) continue;
      const memberRecord: WorkspaceMember = {
        workspaceId: m.workspace_id,
        userId: m.user_id,
        role: (m.role as WorkspaceRole) ?? "member",
        joinedAt: toIsoDate(m.joined_at),
      };
      (state.members![m.workspace_id] ??= []).push(memberRecord);
      const user = (state.users[m.user_id] ??= {
        workspaces: [],
        activeWorkspaceId: null,
      });
      if (!user.workspaces.some((w) => w.id === ws.id)) {
        user.workspaces.push(ws);
      }
    }
    for (const ws of Object.values(state.workspaces!)) {
      const wsMembers = (state.members![ws.id] ??= []);
      if (!wsMembers.some((m) => m.userId === ws.ownerId)) {
        wsMembers.push({
          workspaceId: ws.id,
          userId: ws.ownerId,
          role: "owner",
          joinedAt: toIsoDate(ws.createdAt),
        });
      }
      const ownerUser = (state.users[ws.ownerId] ??= {
        workspaces: [],
        activeWorkspaceId: null,
      });
      if (!ownerUser.workspaces.some((w) => w.id === ws.id)) {
        ownerUser.workspaces.push(ws);
      }
    }
    for (const inv of invitations.rows) {
      if (!state.workspaces![inv.workspace_id]) continue;
      (state.invitations![inv.workspace_id] ??= []).push({
        id: inv.id,
        workspaceId: inv.workspace_id,
        recipientEmail: inv.recipient_email,
        role: inv.role as "admin" | "member",
        status: inv.status as InvitationStatus,
        invitedBy: inv.invited_by,
        createdAt: toIsoDate(inv.created_at),
        expiresAt: toIsoDate(inv.expires_at),
        ...(inv.accepted_at ? { acceptedAt: toIsoDate(inv.accepted_at) } : {}),
        ...(inv.accepted_by ? { acceptedBy: inv.accepted_by } : {}),
        ...(inv.revoked_at ? { revokedAt: toIsoDate(inv.revoked_at) } : {}),
        ...(inv.revoked_by ? { revokedBy: inv.revoked_by } : {}),
      });
    }
    for (const app of approvals.rows) {
      if (!state.workspaces![app.workspace_id]) continue;
      (state.approvals![app.workspace_id] ??= []).push({
        id: app.id,
        workspaceId: app.workspace_id,
        actorId: app.actor_id,
        action: app.action as ProtectedAction,
        target: app.target,
        version: app.version,
        reason: app.reason,
        correlationId: app.correlation_id,
        approvedBy: app.approved_by,
        status: app.status as ApprovalStatus,
        createdAt: toIsoDate(app.created_at),
        expiresAt: toIsoDate(app.expires_at),
        ...(app.consumed_at ? { consumedAt: toIsoDate(app.consumed_at) } : {}),
        ...(app.consumed_by ? { consumedBy: app.consumed_by } : {}),
        ...(app.revoked_at ? { revokedAt: toIsoDate(app.revoked_at) } : {}),
        ...(app.revoked_by ? { revokedBy: app.revoked_by } : {}),
      });
    }
    for (const pol of policies.rows) {
      state.policies![pol.workspace_id] = {
        workspaceId: pol.workspace_id,
        requireApprovalForDelete: pol.require_approval_for_delete,
        requireApprovalForExport: pol.require_approval_for_export,
        requireApprovalForTransfer: pol.require_approval_for_transfer,
        approvalExpiryWindowSeconds: pol.approval_expiry_window_seconds,
        version: pol.version,
        updatedAt: toIsoDate(pol.updated_at),
        updatedBy: pol.updated_by,
      };
    }

    const audit = await client.query<{
      id: string;
      user_id: string;
      workspace_id: string | null;
      action: string;
      occurred_at: string;
      correlation_id: string | null;
    }>(
      "SELECT id, user_id, workspace_id, action, occurred_at, correlation_id FROM hosted_workspace_audit WHERE tenant_id = $1",
      [tenantId]
    );
    state.audit = audit.rows.map((event) => ({
      id: event.id,
      userId: event.user_id,
      ...(event.workspace_id ? { workspaceId: event.workspace_id } : {}),
      ...(event.correlation_id ? { correlationId: event.correlation_id } : {}),
      action: event.action as HostedAuditEvent["action"],
      occurredAt: toIsoDate(event.occurred_at),
    }));
    return state;
  }

  async write(state: HostedWorkspaceState): Promise<void> {
    await this.ensureSchema();
    const client = this.transactionClient.getStore();
    if (!client) return this.withMutationLock(() => this.write(state));
    const tenantId = await this.tenantDatabaseId(client);

    await client.query("DELETE FROM hosted_workspace_audit WHERE tenant_id = $1", [tenantId]);

    const allWorkspaces: HostedWorkspace[] = [];
    if (state.workspaces) {
      allWorkspaces.push(...Object.values(state.workspaces));
    }
    for (const user of Object.values(state.users)) {
      for (const ws of user.workspaces) {
        if (!allWorkspaces.some((w) => w.id === ws.id)) {
          allWorkspaces.push(ws);
        }
      }
    }
    const desiredWorkspaceIds = new Set(allWorkspaces.map((w) => w.id));

    for (const workspace of allWorkspaces) {
      await client.query(
        `INSERT INTO hosted_workspaces (
           id, tenant_id, owner_id, name, created_at, status, deleted_at, recovery_backup_id, recovery_info
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (tenant_id, id) DO UPDATE SET
           owner_id = EXCLUDED.owner_id,
           name = EXCLUDED.name,
           created_at = EXCLUDED.created_at,
           status = EXCLUDED.status,
           deleted_at = EXCLUDED.deleted_at,
           recovery_backup_id = EXCLUDED.recovery_backup_id,
           recovery_info = EXCLUDED.recovery_info`,
        [
          workspace.id,
          tenantId,
          workspace.ownerId,
          workspace.name,
          workspace.createdAt,
          workspace.status ?? "active",
          workspace.deletedAt ?? null,
          workspace.recoveryBackupId ?? null,
          workspace.recoveryInfo ? JSON.stringify(workspace.recoveryInfo) : null,
        ]
      );
    }

    if (desiredWorkspaceIds.size > 0) {
      await client.query(
        "DELETE FROM hosted_workspaces WHERE tenant_id = $1 AND id <> ALL($2::uuid[])",
        [tenantId, Array.from(desiredWorkspaceIds)]
      );
    } else {
      await client.query("DELETE FROM hosted_workspaces WHERE tenant_id = $1", [tenantId]);
    }

    const allMembers: WorkspaceMember[] = [];
    if (state.members) {
      for (const [wsId, mList] of Object.entries(state.members)) {
        if (desiredWorkspaceIds.has(wsId)) {
          allMembers.push(...mList);
        }
      }
    }
    for (const ws of allWorkspaces) {
      if (!allMembers.some((m) => m.workspaceId === ws.id && m.userId === ws.ownerId)) {
        allMembers.push({
          workspaceId: ws.id,
          userId: ws.ownerId,
          role: "owner",
          joinedAt: ws.createdAt,
        });
      }
    }

    await client.query("DELETE FROM hosted_workspace_members WHERE tenant_id = $1", [tenantId]);
    for (const member of allMembers) {
      const user = state.users[member.userId];
      const isActive = user?.activeWorkspaceId === member.workspaceId;
      await client.query(
        `INSERT INTO hosted_workspace_members (tenant_id, workspace_id, user_id, role, joined_at, active_workspace)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE SET
           role = EXCLUDED.role,
           joined_at = EXCLUDED.joined_at,
           active_workspace = EXCLUDED.active_workspace`,
        [tenantId, member.workspaceId, member.userId, member.role, member.joinedAt, isActive]
      );
    }

    const allInvitations: WorkspaceInvitation[] = [];
    if (state.invitations) {
      for (const [wsId, invList] of Object.entries(state.invitations)) {
        if (desiredWorkspaceIds.has(wsId)) {
          allInvitations.push(...invList);
        }
      }
    }
    const desiredInvitationIds = allInvitations.map((i) => i.id);
    for (const inv of allInvitations) {
      await client.query(
        `INSERT INTO hosted_workspace_invitations (
           id, tenant_id, workspace_id, recipient_email, role, status, invited_by,
           created_at, expires_at, accepted_at, accepted_by, revoked_at, revoked_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           accepted_at = EXCLUDED.accepted_at,
           accepted_by = EXCLUDED.accepted_by,
           revoked_at = EXCLUDED.revoked_at,
           revoked_by = EXCLUDED.revoked_by`,
        [
          inv.id,
          tenantId,
          inv.workspaceId,
          inv.recipientEmail,
          inv.role,
          inv.status,
          inv.invitedBy,
          inv.createdAt,
          inv.expiresAt,
          inv.acceptedAt ?? null,
          inv.acceptedBy ?? null,
          inv.revokedAt ?? null,
          inv.revokedBy ?? null,
        ]
      );
    }
    if (desiredInvitationIds.length > 0) {
      await client.query(
        "DELETE FROM hosted_workspace_invitations WHERE tenant_id = $1 AND id <> ALL($2::uuid[])",
        [tenantId, desiredInvitationIds]
      );
    } else {
      await client.query("DELETE FROM hosted_workspace_invitations WHERE tenant_id = $1", [
        tenantId,
      ]);
    }

    const allApprovals: WorkspaceApproval[] = [];
    if (state.approvals) {
      for (const [wsId, appList] of Object.entries(state.approvals)) {
        if (desiredWorkspaceIds.has(wsId)) {
          allApprovals.push(...appList);
        }
      }
    }
    const desiredApprovalIds = allApprovals.map((a) => a.id);
    for (const app of allApprovals) {
      await client.query(
        `INSERT INTO hosted_workspace_approvals (
           id, tenant_id, workspace_id, actor_id, action, target, version, reason,
           correlation_id, approved_by, status, created_at, expires_at,
           consumed_at, consumed_by, revoked_at, revoked_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           consumed_at = EXCLUDED.consumed_at,
           consumed_by = EXCLUDED.consumed_by,
           revoked_at = EXCLUDED.revoked_at,
           revoked_by = EXCLUDED.revoked_by`,
        [
          app.id,
          tenantId,
          app.workspaceId,
          app.actorId,
          app.action,
          app.target,
          app.version,
          app.reason,
          app.correlationId,
          app.approvedBy,
          app.status,
          app.createdAt,
          app.expiresAt,
          app.consumedAt ?? null,
          app.consumedBy ?? null,
          app.revokedAt ?? null,
          app.revokedBy ?? null,
        ]
      );
    }
    if (desiredApprovalIds.length > 0) {
      await client.query(
        "DELETE FROM hosted_workspace_approvals WHERE tenant_id = $1 AND id <> ALL($2::uuid[])",
        [tenantId, desiredApprovalIds]
      );
    } else {
      await client.query("DELETE FROM hosted_workspace_approvals WHERE tenant_id = $1", [tenantId]);
    }

    const allPolicies: WorkspacePolicy[] = [];
    if (state.policies) {
      for (const [wsId, pol] of Object.entries(state.policies)) {
        if (desiredWorkspaceIds.has(wsId)) {
          allPolicies.push(pol);
        }
      }
    }
    const desiredPolicyWorkspaceIds = allPolicies.map((p) => p.workspaceId);
    for (const pol of allPolicies) {
      await client.query(
        `INSERT INTO hosted_workspace_policies (
           tenant_id, workspace_id, require_approval_for_delete, require_approval_for_export,
           require_approval_for_transfer, approval_expiry_window_seconds, version, updated_at, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET
           require_approval_for_delete = EXCLUDED.require_approval_for_delete,
           require_approval_for_export = EXCLUDED.require_approval_for_export,
           require_approval_for_transfer = EXCLUDED.require_approval_for_transfer,
           approval_expiry_window_seconds = EXCLUDED.approval_expiry_window_seconds,
           version = EXCLUDED.version,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [
          tenantId,
          pol.workspaceId,
          pol.requireApprovalForDelete,
          pol.requireApprovalForExport,
          pol.requireApprovalForTransfer,
          pol.approvalExpiryWindowSeconds,
          pol.version,
          pol.updatedAt,
          pol.updatedBy,
        ]
      );
    }
    if (desiredPolicyWorkspaceIds.length > 0) {
      await client.query(
        "DELETE FROM hosted_workspace_policies WHERE tenant_id = $1 AND workspace_id <> ALL($2::uuid[])",
        [tenantId, desiredPolicyWorkspaceIds]
      );
    } else {
      await client.query("DELETE FROM hosted_workspace_policies WHERE tenant_id = $1", [tenantId]);
    }

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
    }
    if (desiredUserIds.length > 0) {
      await client.query(
        "DELETE FROM hosted_workspace_users WHERE tenant_id = $1 AND user_id <> ALL($2::text[])",
        [tenantId, desiredUserIds]
      );
    } else {
      await client.query("DELETE FROM hosted_workspace_users WHERE tenant_id = $1", [tenantId]);
    }

    for (const event of state.audit) {
      await client.query(
        "INSERT INTO hosted_workspace_audit (id, tenant_id, user_id, workspace_id, action, occurred_at, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          event.id,
          tenantId,
          event.userId,
          event.workspaceId ?? null,
          event.action,
          event.occurredAt,
          event.correlationId ?? null,
        ]
      );
    }
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
    if ("end" in this.pool && typeof this.pool.end === "function") {
      await this.pool.end();
    }
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
    return resolveHostedTenantDatabaseId(client, this.tenantId);
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
