import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { withStateLock } from "../local-store/state-lock";
import {
  HostedWorkspaceStore,
  hostedWorkspaceStoreForTenant,
} from "../hosted-workspaces/hosted-workspace-store";
import {
  LocalHostedObjectStore,
  RejectingHostedObjectStore,
  type HostedObjectStore,
} from "./hosted-object-store";
import {
  DeterministicLocalStoreExportAdapter,
  type LocalStoreExportAdapter,
} from "../local-store/local-store-export";
import type {
  DeploymentProjectMapping,
  DeploymentRegistry,
  RegisteredDeploymentRepository,
} from "../hosted-deployments/deployment-resolution";
import {
  assertHostedProductionPersistenceConfigured,
  EncryptedProtectedSecretStore,
  isHostedJsonFixtureMode,
  isHostedNeonConfigured,
  NeonHostedStateProvider,
} from "../hosted-persistence/neon-hosted-provider";

export type HostedRecordKind =
  | "repositories"
  | "workItems"
  | "incomingSignals"
  | "incidents"
  | "automationRuns"
  | "approvals"
  | "artifacts"
  | "skillRuns";
export type ConnectorCapability = "git.read" | "filesystem.read" | "filesystem.write";
export type Freshness = "fresh" | "stale";

export type HostedRepository = {
  id: string;
  localPath: string;
  pathIdentity: string;
  createdAt: string;
};
export type HostedGitHubRepositoryRegistration = RegisteredDeploymentRepository & {
  id: string;
  createdAt: string;
};
export type HostedVercelProjectMapping = DeploymentProjectMapping & {
  updatedAt: string;
};
export type HostedDeploymentState = {
  vercelProject: HostedVercelProjectMapping | null;
  vercelProjectHistory: HostedVercelProjectMapping[];
  githubRepositories: HostedGitHubRepositoryRegistration[];
};
export type HostedCapabilityGrant = {
  id: string;
  capability: ConnectorCapability;
  skillId?: string;
  allowedPaths?: string[];
};
export type HostedConnector = {
  id: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
  state: "connected" | "offline" | "revoked";
  repositoryIds: string[];
  capabilities: Record<string, HostedCapabilityGrant[]>;
};
export type HostedSnapshot = {
  id: string;
  connectorId: string;
  repositoryId: string;
  source: "local-connector";
  freshness: Freshness;
  publishedAt: string;
  sourceCommit: string | null;
  data: Record<string, unknown>;
};
export type HostedCredentialMetadata = {
  id: string;
  provider: string;
  scopes: string[];
  status: "active" | "revoked";
  expiresAt: string | null;
  identity: string | null;
  health: "unknown" | "healthy" | "unhealthy";
  createdAt: string;
};
type HostedCredentialRecord = HostedCredentialMetadata & {
  workspaceId: string;
  secretReference: string;
};
export type HostedAudit = {
  id: string;
  userId: string;
  workspaceId?: string;
  action: string;
  subjectId?: string;
  repositoryId?: string;
  capability?: string;
  outcome?: "allowed" | "denied";
  occurredAt: string;
};
export type HostedBackup = {
  version: 1;
  exportedAt: string;
  workspaceId: string;
  workspace: { id: string; name: string; ownerId: string };
  restorationIdentity: { workspaceId: string; ownerId: string };
  repositories: HostedRepository[];
  records: Record<HostedRecordKind, Array<Record<string, unknown>>>;
  relationships: Array<{ from: string; to: string; kind: string }>;
  snapshots: HostedSnapshot[];
  credentials: HostedCredentialMetadata[];
  connectors: HostedConnector[];
  audit: HostedAudit[];
};
export type MigrationPackage = {
  version: 1;
  exportedAt: string;
  repositories: Array<{ id?: string; localPath: string; pathIdentity: string }>;
  records: Partial<Record<HostedRecordKind, Array<Record<string, unknown>>>>;
  relationships: Array<{ from: string; to: string; kind: string }>;
  warnings: string[];
};
export type ProviderApproval = {
  approved?: boolean;
  runId?: string;
  reason?: string;
  action?: string;
  evidenceSnapshotId?: string;
};

type HostedRecordMap = Partial<Record<HostedRecordKind, Array<Record<string, unknown>>>>;
export type HostedState = {
  repositories: Record<string, HostedRepository[]>;
  records: Record<string, HostedRecordMap>;
  relationships: Record<string, Array<{ from: string; to: string; kind: string }>>;
  snapshots: Record<string, HostedSnapshot[]>;
  connectors: HostedConnector[];
  credentials: HostedCredentialRecord[];
  audit: HostedAudit[];
  vercelProject?: HostedVercelProjectMapping | null;
  vercelProjectHistory?: HostedVercelProjectMapping[];
  githubRepositories?: HostedGitHubRepositoryRegistration[];
};

const emptyState = (): HostedState => ({
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

export interface HostedStateProvider {
  read(): Promise<HostedState>;
  write(state: HostedState): Promise<void>;
  readDeploymentState?(): Promise<HostedDeploymentState>;
  writeDeploymentState?(state: HostedDeploymentState): Promise<void>;
  rotateVercelWebhookSecret?(input: { projectId: string; activeReference: string }): Promise<void>;
  withMutationLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ProtectedSecretStore {
  put(secret: string): Promise<string>;
}

export class DeterministicProtectedSecretStore implements ProtectedSecretStore {
  async put(secret: string): Promise<string> {
    if (!secret) throw new HostedDomainError("INVALID", "Credential secret is required.");
    return `fixture-secret://${createHash("sha256").update(secret).digest("hex")}`;
  }
}

export class DeterministicJsonHostedStateProvider implements HostedStateProvider {
  private readonly path: string;
  private readonly root: string;
  constructor(root = process.cwd()) {
    this.root = resolve(root);
    this.path = join(this.root, ".developer-agentic-os", "hosted-domain.json");
  }
  async read(): Promise<HostedState> {
    this.assertFixtureOnly();
    return readJsonFile(this.path, emptyState());
  }
  async write(state: HostedState): Promise<void> {
    this.assertFixtureOnly();
    await writeJsonFile(this.path, state);
  }
  private assertFixtureOnly(): void {
    if (
      (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") ||
      process.env.HOSTED_JSON_FIXTURE_MODE !== "true"
    )
      throw new HostedDomainError(
        "INVALID",
        "The deterministic JSON hosted backend is fixture-only; configure a transactional hosted state provider for production."
      );
  }
}

export class HostedDomainError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "STALE",
    message: string
  ) {
    super(message);
    this.name = "HostedDomainError";
  }
}

export class HostedDomainStore {
  constructor(
    private readonly root = process.cwd(),
    private readonly workspaceStore = new HostedWorkspaceStore(root),
    private readonly provider: HostedStateProvider = new DeterministicJsonHostedStateProvider(root),
    private readonly objectStore: HostedObjectStore = new LocalHostedObjectStore(
      join(root, ".developer-agentic-os", "hosted-objects")
    ),
    private readonly localExport: LocalStoreExportAdapter = new DeterministicLocalStoreExportAdapter(
      root
    ),
    private readonly secretStore: ProtectedSecretStore = new DeterministicProtectedSecretStore(),
    private readonly tenantId = "legacy"
  ) {}

  async createWorkspace(userId: string, name: string) {
    return this.workspaceStore.create(userId, name);
  }

  async registerRepository(
    userId: string,
    workspaceId: string,
    localPath: string
  ): Promise<HostedRepository> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const canonicalPath = this.canonicalPath(localPath);
      const pathIdentity = createHash("sha256").update(canonicalPath.toLowerCase()).digest("hex");
      const repositories =
        state.repositories[workspaceId] ?? (state.repositories[workspaceId] = []);
      const existing = repositories.find((item) => item.pathIdentity === pathIdentity);
      if (existing) return existing;
      const repository = {
        id: randomUUID(),
        localPath: canonicalPath,
        pathIdentity,
        createdAt: new Date().toISOString(),
      };
      repositories.push(repository);
      await this.auditEvent(state, userId, workspaceId, "repository.registered", repository.id);
      await this.write(state);
      return repository;
    });
  }

  async putRecord(
    userId: string,
    workspaceId: string,
    kind: HostedRecordKind,
    value: Record<string, unknown>
  ): Promise<Record<string, unknown> & { id: string }> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const records = state.records[workspaceId] ?? (state.records[workspaceId] = {});
      const list = records[kind] ?? (records[kind] = []);
      const identity = typeof value.externalId === "string" ? value.externalId : null;
      const existing = identity ? list.find((item) => item.externalId === identity) : undefined;
      if (existing && typeof existing.id === "string")
        return existing as Record<string, unknown> & { id: string };
      const storedValue =
        kind === "artifacts" && "content" in value ? await this.externalizeArtifact(value) : value;
      const record = {
        ...storedValue,
        id: randomUUID(),
        workspaceId,
        createdAt: new Date().toISOString(),
      };
      list.push(record);
      await this.auditEvent(state, userId, workspaceId, `${kind}.created`, record.id);
      await this.write(state);
      return record;
    });
  }

  async listRecords(
    userId: string,
    workspaceId: string,
    kind: HostedRecordKind
  ): Promise<Array<Record<string, unknown>>> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    return state.records[workspaceId]?.[kind] ?? [];
  }
  async listAllRecords(userId: string, workspaceId: string): Promise<HostedRecordMap> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    return state.records[workspaceId] ?? {};
  }
  async listRepositories(userId: string, workspaceId: string): Promise<HostedRepository[]> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    return state.repositories[workspaceId] ?? [];
  }

  async getVercelProject(
    userId: string,
    workspaceId: string
  ): Promise<HostedVercelProjectMapping | null> {
    const state = await this.readDeploymentState();
    await this.assertWorkspace(userId, workspaceId);
    return state.vercelProject;
  }

  async setVercelProject(
    userId: string,
    workspaceId: string,
    input: DeploymentProjectMapping,
    webhookSecret?: string
  ): Promise<HostedVercelProjectMapping> {
    if (!input.projectId.trim())
      throw new HostedDomainError("INVALID", "A Vercel project id is required.");
    if (webhookSecret !== undefined && !webhookSecret.trim())
      throw new HostedDomainError("INVALID", "A webhook secret is required.");
    return this.withMutationLock(async () => {
      const state = await this.read();
      const deploymentState = await this.readDeploymentState(state);
      await this.assertWorkspace(userId, workspaceId);
      const mapping: HostedVercelProjectMapping = {
        projectId: input.projectId.trim(),
        ...(input.teamId?.trim() ? { teamId: input.teamId.trim() } : {}),
        updatedAt: new Date().toISOString(),
      };
      if (deploymentState.vercelProject) {
        deploymentState.vercelProjectHistory.push(deploymentState.vercelProject);
      }
      deploymentState.vercelProject = mapping;
      await this.auditEvent(state, userId, workspaceId, "vercel.project.mapping.updated");
      await this.writeDeploymentState(state, deploymentState);
      if (webhookSecret !== undefined && this.provider.rotateVercelWebhookSecret)
        await this.provider.rotateVercelWebhookSecret({
          projectId: mapping.projectId,
          activeReference: await this.secretStore.put(webhookSecret.trim()),
        });
      await this.write(state);
      return mapping;
    });
  }

  async removeVercelProject(userId: string, workspaceId: string): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      const deploymentState = await this.readDeploymentState(state);
      await this.assertWorkspace(userId, workspaceId);
      deploymentState.vercelProject = null;
      await this.auditEvent(state, userId, workspaceId, "vercel.project.mapping.removed");
      await this.writeDeploymentState(state, deploymentState);
      await this.write(state);
    });
  }

  async setVercelWebhookSecret(userId: string, workspaceId: string, secret: string): Promise<void> {
    if (!secret.trim()) throw new HostedDomainError("INVALID", "A webhook secret is required.");
    return this.withMutationLock(async () => {
      const state = await this.read();
      const deploymentState = await this.readDeploymentState(state);
      await this.assertWorkspace(userId, workspaceId);
      if (!deploymentState.vercelProject)
        throw new HostedDomainError("NOT_FOUND", "Vercel project mapping not found.");
      const activeReference = await this.secretStore.put(secret.trim());
      if (this.provider.rotateVercelWebhookSecret)
        await this.provider.rotateVercelWebhookSecret({
          projectId: deploymentState.vercelProject.projectId,
          activeReference,
        });
      await this.auditEvent(state, userId, workspaceId, "vercel.webhook.secret.updated");
      await this.write(state);
    });
  }

  async registerGitHubRepository(
    userId: string,
    workspaceId: string,
    input: Omit<HostedGitHubRepositoryRegistration, "id" | "createdAt" | "tenantId">
  ): Promise<HostedGitHubRepositoryRegistration> {
    if (!input.owner.trim() || !input.repository.trim())
      throw new HostedDomainError("INVALID", "GitHub owner and repository are required.");
    if (!input.workflow.trim() || input.ref.trim() !== "refs/heads/main")
      throw new HostedDomainError("INVALID", "Deployment workflow and ref are required.");
    return this.withMutationLock(async () => {
      const state = await this.read();
      const deploymentState = await this.readDeploymentState(state);
      await this.assertWorkspace(userId, workspaceId);
      const repositories = deploymentState.githubRepositories;
      const existing = repositories.find(
        (repository) =>
          repository.owner.toLowerCase() === input.owner.trim().toLowerCase() &&
          repository.repository.toLowerCase() === input.repository.trim().toLowerCase()
      );
      if (existing) return existing;
      const registration: HostedGitHubRepositoryRegistration = {
        id: randomUUID(),
        tenantId: this.tenantId,
        owner: input.owner.trim(),
        repository: input.repository.trim(),
        workflow: input.workflow.trim(),
        ref: input.ref.trim(),
        createdAt: new Date().toISOString(),
      };
      repositories.push(registration);
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "github.repository.registered",
        registration.id
      );
      await this.writeDeploymentState(state, deploymentState);
      await this.write(state);
      return registration;
    });
  }

  async listGitHubRepositories(
    userId: string,
    workspaceId: string
  ): Promise<HostedGitHubRepositoryRegistration[]> {
    const state = await this.readDeploymentState();
    await this.assertWorkspace(userId, workspaceId);
    return state.githubRepositories;
  }

  deploymentRegistry(): DeploymentRegistry {
    return {
      findRepository: async (tenantId, owner, repository) => {
        const state = await this.readDeploymentState();
        if (tenantId !== this.tenantId) return null;
        return (
          state.githubRepositories.find(
            (item) =>
              item.owner.toLowerCase() === owner.toLowerCase() &&
              item.repository.toLowerCase() === repository.toLowerCase()
          ) ?? null
        );
      },
      findProject: async (tenantId) => {
        const state = await this.readDeploymentState();
        return tenantId === this.tenantId ? state.vercelProject : null;
      },
    };
  }

  async recordDeploymentResolution(
    userId: string,
    outcome: "allowed" | "denied",
    subjectId?: string,
    target?: DeploymentProjectMapping,
    workspaceId?: string
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "deployment.resolution",
        subjectId,
        undefined,
        undefined,
        outcome
      );
      if (workspaceId && outcome === "allowed" && target) {
        const records = state.records[workspaceId] ?? (state.records[workspaceId] = {});
        const deployments = records.automationRuns ?? (records.automationRuns = []);
        deployments.push({
          id: randomUUID(),
          workspaceId,
          subjectId,
          projectId: target.projectId,
          ...(target.teamId ? { teamId: target.teamId } : {}),
          status: "resolved",
          createdAt: new Date().toISOString(),
        });
      }
      await this.write(state);
    });
  }
  async listSnapshots(userId: string, workspaceId: string): Promise<HostedSnapshot[]> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      if (this.normalizeExpiredConnectors(state, workspaceId)) await this.write(state);
      return state.snapshots[workspaceId] ?? [];
    });
  }

  async registerConnector(
    userId: string,
    workspaceId: string,
    ttlMs: number
  ): Promise<HostedConnector> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector: HostedConnector = {
        id: randomUUID(),
        workspaceId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        state: "connected",
        repositoryIds: [],
        capabilities: {},
      };
      state.connectors.push(connector);
      await this.auditEvent(state, userId, workspaceId, "connector.registered", connector.id);
      await this.write(state);
      return connector;
    });
  }

  async grantRepository(
    userId: string,
    workspaceId: string,
    connectorId: string,
    repositoryId: string
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      this.assertConnectorRepository(state, connector, workspaceId, repositoryId);
      if (!connector.repositoryIds.includes(repositoryId))
        connector.repositoryIds.push(repositoryId);
      connector.capabilities[repositoryId] ??= [{ id: randomUUID(), capability: "git.read" }];
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "connector.repository.granted",
        connectorId,
        repositoryId
      );
      await this.write(state);
    });
  }
  async revokeRepository(
    userId: string,
    workspaceId: string,
    connectorId: string,
    repositoryId: string
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      this.assertConnectorRepository(state, connector, workspaceId, repositoryId);
      connector.repositoryIds = connector.repositoryIds.filter((id) => id !== repositoryId);
      delete connector.capabilities[repositoryId];
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "connector.repository.revoked",
        connectorId,
        repositoryId
      );
      await this.write(state);
    });
  }
  async grantCapability(
    userId: string,
    workspaceId: string,
    connectorId: string,
    repositoryId: string,
    capability: ConnectorCapability,
    skillId?: string,
    allowedPaths?: string[]
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      this.assertConnectorRepository(state, connector, workspaceId, repositoryId);
      if (capability !== "git.read" && (!skillId?.trim() || !allowedPaths?.length))
        throw new HostedDomainError(
          "INVALID",
          "Filesystem grants require a Skill identity and at least one allowlisted path."
        );
      const repository = (state.repositories[workspaceId] ?? []).find(
        (item) => item.id === repositoryId
      )!;
      const canonicalPaths =
        capability === "git.read"
          ? undefined
          : allowedPaths!.map((path) => this.assertWithinRepository(repository.localPath, path));
      const grants =
        connector.capabilities[repositoryId] ?? (connector.capabilities[repositoryId] = []);
      if (!grants.some((grant) => grant.capability === capability && grant.skillId === skillId))
        grants.push({
          id: randomUUID(),
          capability,
          ...(skillId ? { skillId } : {}),
          ...(canonicalPaths ? { allowedPaths: canonicalPaths } : {}),
        });
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "connector.capability.granted",
        connectorId,
        repositoryId,
        capability
      );
      await this.write(state);
    });
  }
  async revokeConnector(userId: string, workspaceId: string, connectorId: string): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      if (connector.workspaceId !== workspaceId)
        throw new HostedDomainError("FORBIDDEN", "Connector access denied.");
      connector.state = "revoked";
      this.markSnapshotsStale(state, workspaceId, connector);
      await this.auditEvent(state, userId, workspaceId, "connector.revoked", connectorId);
      await this.write(state);
    });
  }
  async revokeCapability(
    userId: string,
    workspaceId: string,
    connectorId: string,
    repositoryId: string,
    grantId: string
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      this.assertConnectorRepository(state, connector, workspaceId, repositoryId);
      const grants = connector.capabilities[repositoryId] ?? [];
      const next = grants.filter((grant) => grant.id !== grantId);
      if (next.length === grants.length)
        throw new HostedDomainError("NOT_FOUND", "Capability grant not found.");
      connector.capabilities[repositoryId] = next;
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "connector.capability.revoked",
        connectorId,
        repositoryId
      );
      await this.write(state);
    });
  }
  async setConnectorOffline(
    userId: string,
    workspaceId: string,
    connectorId: string
  ): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      if (connector.workspaceId !== workspaceId)
        throw new HostedDomainError("FORBIDDEN", "Connector access denied.");
      connector.state = "offline";
      this.markSnapshotsStale(state, workspaceId, connector);
      await this.auditEvent(state, userId, workspaceId, "connector.offline", connectorId);
      await this.write(state);
    });
  }
  async reconnectConnector(
    userId: string,
    workspaceId: string,
    connectorId: string,
    ttlMs: number
  ): Promise<HostedConnector> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      if (connector.workspaceId !== workspaceId || connector.state === "revoked")
        throw new HostedDomainError("FORBIDDEN", "Connector cannot be reconnected.");
      connector.state = "connected";
      connector.expiresAt = new Date(Date.now() + ttlMs).toISOString();
      await this.auditEvent(state, userId, workspaceId, "connector.reconnected", connectorId);
      await this.write(state);
      return connector;
    });
  }

  async connectorRequest(
    userId: string,
    connectorId: string,
    workspaceId: string,
    repositoryId: string,
    capability: ConnectorCapability,
    skillId?: string,
    requestedPath?: string
  ): Promise<{ allowed: true }> {
    const result = await this.withMutationLock(async () => {
      const state = await this.read();
      const connector = await this.assertConnectorAccess(
        state,
        userId,
        connectorId,
        workspaceId,
        repositoryId,
        capability,
        skillId,
        requestedPath
      );
      if (connector instanceof HostedDomainError) return { error: connector };
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "connector.request",
        connector.id,
        repositoryId,
        capability,
        "allowed"
      );
      await this.write(state);
      return { value: { allowed: true as const } };
    });
    if ("error" in result) throw result.error;
    return result.value;
  }

  async publishSnapshot(
    userId: string,
    connectorId: string,
    workspaceId: string,
    repositoryId: string,
    data: Record<string, unknown>
  ): Promise<HostedSnapshot> {
    const result = await this.withMutationLock(async () => {
      const state = await this.read();
      const connector = await this.assertConnectorAccess(
        state,
        userId,
        connectorId,
        workspaceId,
        repositoryId,
        "git.read"
      );
      if (connector instanceof HostedDomainError) return { error: connector };
      const snapshot: HostedSnapshot = {
        id: randomUUID(),
        connectorId: connector.id,
        repositoryId,
        source: "local-connector",
        freshness: "fresh",
        publishedAt: new Date().toISOString(),
        sourceCommit: typeof data.commit === "string" ? data.commit : null,
        data,
      };
      const snapshots = state.snapshots[workspaceId] ?? (state.snapshots[workspaceId] = []);
      snapshots
        .filter((item) => item.repositoryId === repositoryId)
        .forEach((item) => {
          item.freshness = "stale";
        });
      snapshots.push(snapshot);
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "repository.snapshot.published",
        snapshot.id,
        repositoryId
      );
      await this.write(state);
      return { value: snapshot };
    });
    if ("error" in result) throw result.error;
    return result.value;
  }
  async queueLocalWork(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    description: string
  ): Promise<{ id: string; status: "pending_offline" }> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      this.assertRepositoryMembership(state, workspaceId, repositoryId);
      const records = state.records[workspaceId] ?? (state.records[workspaceId] = {});
      const list = records.automationRuns ?? (records.automationRuns = []);
      const record = {
        repositoryId,
        description,
        status: "pending_offline",
        provenance: "local-connector",
        id: randomUUID(),
        workspaceId,
        createdAt: new Date().toISOString(),
      };
      list.push(record);
      await this.auditEvent(state, userId, workspaceId, "automationRuns.created", record.id);
      await this.write(state);
      return { id: record.id, status: "pending_offline" };
    });
  }
  async resumePendingLocalWork(
    userId: string,
    workspaceId: string,
    connectorId: string
  ): Promise<number> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const connector = this.connector(state, connectorId);
      if (connector.workspaceId !== workspaceId || connector.state !== "connected")
        throw new HostedDomainError("FORBIDDEN", "Connector is not connected.");
      const pending = (state.records[workspaceId]?.automationRuns ?? []).filter(
        (record) =>
          record.status === "pending_offline" &&
          typeof record.repositoryId === "string" &&
          connector.repositoryIds.includes(record.repositoryId)
      );
      for (const record of pending) {
        record.status = "queued";
        record.resumedAt = new Date().toISOString();
      }
      if (pending.length)
        await this.auditEvent(state, userId, workspaceId, "local-work.resumed", connectorId);
      await this.write(state);
      return pending.length;
    });
  }
  async hostedSafeWork(
    userId: string,
    workspaceId: string,
    description: string
  ): Promise<{ id: string; status: "completed" }> {
    const record = await this.putRecord(userId, workspaceId, "automationRuns", {
      description,
      status: "completed",
      provenance: "hosted",
    });
    return { id: String(record.id), status: "completed" };
  }
  async authorizeProviderMutation(
    userId: string,
    workspaceId: string,
    repositoryId: string,
    providerAction: string,
    approval?: ProviderApproval
  ): Promise<void> {
    const authorizationError = await this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      this.assertRepositoryMembership(state, workspaceId, repositoryId);
      const connector = state.connectors.find(
        (item) =>
          item.workspaceId === workspaceId &&
          item.state === "connected" &&
          item.repositoryIds.includes(repositoryId) &&
          Date.parse(item.expiresAt) > Date.now()
      );
      const snapshot = (state.snapshots[workspaceId] ?? []).find(
        (item) =>
          item.repositoryId === repositoryId &&
          item.connectorId === connector?.id &&
          item.freshness === "fresh"
      );
      const approvalRunId = approval?.runId;
      const approvedRun = approvalRunId
        ? (state.records[workspaceId]?.automationRuns ?? []).find(
            (record) =>
              record.id === approvalRunId &&
              record.workspaceId === workspaceId &&
              record.repositoryId === repositoryId &&
              record.status === "approved" &&
              isRecord(record.approval) &&
              record.approval.action === providerAction &&
              record.approval.evidenceSnapshotId === snapshot?.id
          )
        : undefined;
      let error: HostedDomainError | null = null;
      if (!connector || !snapshot)
        error = new HostedDomainError(
          "STALE",
          "Provider mutations require fresh connector evidence from the current connector."
        );
      else if (!approvedRun || !approvalRunId)
        error = new HostedDomainError(
          "FORBIDDEN",
          "Provider mutations require a persisted approval bound to the current evidence and action."
        );
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "provider.mutation.authorization",
        approvalRunId,
        repositoryId,
        undefined,
        error ? "denied" : "allowed"
      );
      await this.write(state);
      return error;
    });
    if (authorizationError) throw authorizationError;
  }

  async runReadOnlySkill(
    userId: string,
    workspaceId: string,
    connectorId: string,
    repositoryId: string,
    skillId: string
  ): Promise<Record<string, unknown>> {
    const outcome = await this.withMutationLock(async () => {
      const state = await this.read();
      const connector = await this.assertConnectorAccess(
        state,
        userId,
        connectorId,
        workspaceId,
        repositoryId,
        "git.read",
        skillId
      );
      if (connector instanceof HostedDomainError) return { error: connector };
      const records = state.records[workspaceId] ?? (state.records[workspaceId] = {});
      const list = records.skillRuns ?? (records.skillRuns = []);
      const result = {
        repositoryId,
        skillId,
        capability: "git.read",
        result: "completed",
        readOnly: true,
        id: randomUUID(),
        workspaceId,
        createdAt: new Date().toISOString(),
      };
      list.push(result);
      await this.auditEvent(
        state,
        userId,
        workspaceId,
        "skill.read-only.executed",
        result.id,
        repositoryId,
        "git.read",
        "allowed"
      );
      await this.write(state);
      return { value: result };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }

  async listConnectorStatus(userId: string, workspaceId: string): Promise<HostedConnector[]> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      let changed = false;
      for (const connector of state.connectors.filter((item) => item.workspaceId === workspaceId))
        if (connector.state === "connected" && Date.parse(connector.expiresAt) <= Date.now()) {
          connector.state = "offline";
          this.markSnapshotsStale(state, workspaceId, connector);
          changed = true;
        }
      if (changed) await this.write(state);
      return state.connectors.filter((item) => item.workspaceId === workspaceId);
    });
  }
  async listRepositoryGrants(
    userId: string,
    workspaceId: string
  ): Promise<Array<{ connectorId: string; repositoryIds: string[] }>> {
    return (await this.listConnectorStatus(userId, workspaceId)).map((connector) => ({
      connectorId: connector.id,
      repositoryIds: [...connector.repositoryIds],
    }));
  }
  async listCapabilityGrants(
    userId: string,
    workspaceId: string
  ): Promise<
    Array<{ connectorId: string; repositoryId: string; grants: HostedCapabilityGrant[] }>
  > {
    return (await this.listConnectorStatus(userId, workspaceId)).flatMap((connector) =>
      Object.entries(connector.capabilities).map(([repositoryId, grants]) => ({
        connectorId: connector.id,
        repositoryId,
        grants,
      }))
    );
  }

  async saveCredential(
    userId: string,
    workspaceId: string,
    input: {
      provider: string;
      scopes: string[];
      secret: string;
      expiresAt?: string | null;
      identity?: string | null;
    }
  ): Promise<HostedCredentialMetadata> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const secretReference = await this.secretStore.put(input.secret);
      const credential: HostedCredentialRecord = {
        id: randomUUID(),
        provider: input.provider,
        scopes: [...input.scopes],
        status: "active",
        expiresAt: input.expiresAt ?? null,
        identity: input.identity ?? null,
        health: "unknown",
        secretReference,
        workspaceId,
        createdAt: new Date().toISOString(),
      };
      state.credentials.push(credential);
      await this.auditEvent(state, userId, workspaceId, "credential.saved", credential.id);
      await this.write(state);
      return this.publicCredential(credential);
    });
  }
  async listCredentials(userId: string, workspaceId: string): Promise<HostedCredentialMetadata[]> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    return state.credentials
      .filter((item) => item.workspaceId === workspaceId)
      .map((item) => this.publicCredential(item));
  }
  async revokeCredential(userId: string, workspaceId: string, credentialId: string): Promise<void> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const credential = state.credentials.find(
        (item) => item.id === credentialId && item.workspaceId === workspaceId
      );
      if (!credential) throw new HostedDomainError("NOT_FOUND", "Credential not found.");
      credential.status = "revoked";
      await this.auditEvent(state, userId, workspaceId, "credential.revoked", credentialId);
      await this.write(state);
    });
  }

  async exportBackup(userId: string, workspaceId: string): Promise<HostedBackup> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      const workspace = await this.assertWorkspace(userId, workspaceId);
      if (this.normalizeExpiredConnectors(state, workspaceId)) await this.write(state);
      const credentials = state.credentials
        .filter((item) => item.workspaceId === workspaceId)
        .map((item) => this.publicCredential(item));
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        workspaceId,
        workspace,
        restorationIdentity: { workspaceId, ownerId: workspace.ownerId },
        repositories: state.repositories[workspaceId] ?? [],
        records: Object.fromEntries(
          Object.entries(state.records[workspaceId] ?? {}).map(([key, value]) => [key, value ?? []])
        ) as Record<HostedRecordKind, Array<Record<string, unknown>>>,
        relationships: state.relationships?.[workspaceId] ?? [],
        snapshots: state.snapshots[workspaceId] ?? [],
        credentials,
        connectors: state.connectors.filter((item) => item.workspaceId === workspaceId),
        audit: state.audit.filter((event) => event.workspaceId === workspaceId),
      };
    });
  }
  async exportMigration(userId: string, workspaceId: string): Promise<MigrationPackage> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    const local = await this.localExport.export();
    const repositories = [...(state.repositories[workspaceId] ?? [])].map(
      ({ id, localPath, pathIdentity }) => ({ id, localPath, pathIdentity })
    );
    const knownPaths = new Set(repositories.map((repository) => repository.pathIdentity));
    for (const repository of local.repositories)
      if (!knownPaths.has(repository.pathIdentity)) repositories.push(repository);
    const records = mergeRecordMaps(local.records, state.records[workspaceId] ?? {});
    const warnings = Object.values(records)
      .flat()
      .filter((record) => !record || typeof record.repositoryId !== "string").length
      ? ["Some records have missing repository provenance."]
      : [];
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      repositories,
      records,
      relationships: mergeRelationships(
        local.relationships,
        state.relationships?.[workspaceId] ?? []
      ),
      warnings,
    };
  }
  async importMigration(
    userId: string,
    workspaceId: string,
    packageData: MigrationPackage,
    selectedKinds?: HostedRecordKind[],
    selectedRepositoryIds?: string[]
  ): Promise<{ imported: number; warnings: string[] }> {
    return this.withMutationLock(async () => {
      const state = await this.read();
      await this.assertWorkspace(userId, workspaceId);
      const warnings = [...packageData.warnings];
      const repositories =
        state.repositories[workspaceId] ?? (state.repositories[workspaceId] = []);
      const repositoryIds = new Map<string, string>();
      const selected = selectedRepositoryIds
        ? new Set(selectedRepositoryIds)
        : new Set(
            packageData.repositories.flatMap((repository) => (repository.id ? [repository.id] : []))
          );
      if (
        selectedRepositoryIds?.some(
          (id) => !packageData.repositories.some((repository) => repository.id === id)
        )
      )
        throw new HostedDomainError(
          "INVALID",
          "Selected repository is not present in the migration package."
        );
      for (const repository of packageData.repositories) {
        if (!repository.id || !selected.has(repository.id)) continue;
        const existing = repositories.find((item) => item.pathIdentity === repository.pathIdentity);
        const target = existing ?? {
          id: randomUUID(),
          localPath: repository.localPath,
          pathIdentity: repository.pathIdentity,
          createdAt: new Date().toISOString(),
        };
        if (!existing) repositories.push(target);
        if (repository.id) repositoryIds.set(repository.id, target.id);
      }
      let imported = 0;
      const recordIds = new Map<string, string>();
      for (const [kind, records] of Object.entries(packageData.records)) {
        if (selectedKinds && !selectedKinds.includes(kind as HostedRecordKind)) continue;
        for (const record of records ?? []) {
          const list = ((state.records[workspaceId] ??= {})[kind as HostedRecordKind] ??= []);
          const externalId =
            typeof record.externalId === "string"
              ? record.externalId
              : `${packageData.version}:${kind}:${record.id ?? JSON.stringify(record)}`;
          if (
            typeof record.repositoryId === "string" &&
            packageData.repositories.some((repository) => repository.id === record.repositoryId) &&
            !repositoryIds.has(record.repositoryId)
          )
            continue;
          const existing = list.find((item) => item.externalId === externalId);
          if (existing && typeof existing.id === "string") {
            if (typeof record.id === "string") recordIds.set(record.id, existing.id);
            continue;
          }
          if (typeof record.repositoryId === "string" && !repositoryIds.has(record.repositoryId))
            throw new HostedDomainError(
              "INVALID",
              `Record ${String(record.id ?? externalId)} has unmapped repository provenance.`
            );
          const repositoryId =
            typeof record.repositoryId === "string"
              ? repositoryIds.get(record.repositoryId)
              : undefined;
          const importedRecord = {
            ...record,
            ...(repositoryId ? { repositoryId } : {}),
            id: randomUUID(),
            externalId,
            workspaceId,
            importedAt: new Date().toISOString(),
          };
          list.push(importedRecord);
          if (typeof record.id === "string") recordIds.set(record.id, importedRecord.id);
          imported += 1;
        }
      }
      state.relationships ??= {};
      const relationships =
        state.relationships[workspaceId] ?? (state.relationships[workspaceId] = []);
      for (const relationship of packageData.relationships) {
        const from = recordIds.get(relationship.from) ?? repositoryIds.get(relationship.from);
        const to = recordIds.get(relationship.to) ?? repositoryIds.get(relationship.to);
        if (!from || !to) {
          warnings.push(
            `Skipped relationship ${relationship.kind}: source records were not imported.`
          );
          continue;
        }
        if (
          !relationships.some(
            (item) => item.from === from && item.to === to && item.kind === relationship.kind
          )
        )
          relationships.push({ from, to, kind: relationship.kind });
      }
      await this.auditEvent(state, userId, workspaceId, "migration.imported");
      await this.write(state);
      return { imported, warnings };
    });
  }
  async audit(userId: string, workspaceId: string): Promise<HostedAudit[]> {
    const state = await this.read();
    await this.assertWorkspace(userId, workspaceId);
    return state.audit.filter(
      (event) => event.userId === userId && event.workspaceId === workspaceId
    );
  }
  async mutateAudit(id: string): Promise<never> {
    void id;
    throw new HostedDomainError("FORBIDDEN", "Audit records are immutable.");
  }

  private async recordDenied(
    state: HostedState,
    userId: string,
    connector: HostedConnector,
    workspaceId: string,
    repositoryId: string,
    capability: ConnectorCapability
  ): Promise<void> {
    await this.auditEvent(
      state,
      userId,
      workspaceId,
      "connector.request",
      connector.id,
      repositoryId,
      capability,
      "denied"
    );
    await this.write(state);
  }
  private async assertConnectorAccess(
    state: HostedState,
    userId: string,
    connectorId: string,
    workspaceId: string,
    repositoryId: string,
    capability: ConnectorCapability,
    skillId?: string,
    requestedPath?: string
  ): Promise<HostedConnector | HostedDomainError> {
    await this.assertWorkspace(userId, workspaceId);
    const connector = this.connector(state, connectorId);
    this.assertRepositoryMembership(state, workspaceId, repositoryId);
    const repository = (state.repositories[workspaceId] ?? []).find(
      (item) => item.id === repositoryId
    )!;
    const grants = connector.capabilities[repositoryId] ?? [];
    const grant = grants.find(
      (item) =>
        item.capability === capability &&
        (capability === "git.read" ||
          (item.skillId === skillId &&
            this.pathAllowed(repository.localPath, item.allowedPaths, requestedPath)))
    );
    const valid =
      connector.workspaceId === workspaceId &&
      connector.state === "connected" &&
      Date.parse(connector.expiresAt) > Date.now() &&
      connector.repositoryIds.includes(repositoryId) &&
      grants.every((item) => typeof item !== "string") &&
      Boolean(grant);
    if (!valid) {
      await this.recordDenied(state, userId, connector, workspaceId, repositoryId, capability);
      return new HostedDomainError(
        "FORBIDDEN",
        connector.state === "revoked"
          ? "Connector is revoked."
          : "Connector capability is not granted."
      );
    }
    return connector;
  }
  private connector(state: HostedState, id: string): HostedConnector {
    const connector = state.connectors.find((item) => item.id === id);
    if (!connector) throw new HostedDomainError("NOT_FOUND", "Connector not found.");
    if (Date.parse(connector.expiresAt) <= Date.now() && connector.state === "connected")
      connector.state = "offline";
    return connector;
  }
  private async assertWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<import("@/types/hosted-workspace").HostedWorkspace> {
    const workspaces = await this.workspaceStore.list(userId);
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new HostedDomainError("NOT_FOUND", "Workspace not found.");
    return workspace;
  }
  private workspaceOwner(workspaceId: string): Promise<string> {
    return this.workspaceStore.owner(workspaceId);
  }
  private markSnapshotsStale(
    state: HostedState,
    workspaceId: string,
    connector: HostedConnector
  ): void {
    for (const snapshot of state.snapshots[workspaceId] ?? [])
      if (snapshot.connectorId === connector.id) snapshot.freshness = "stale";
  }
  private normalizeExpiredConnectors(state: HostedState, workspaceId: string): boolean {
    let changed = false;
    for (const connector of state.connectors.filter((item) => item.workspaceId === workspaceId))
      if (connector.state === "connected" && Date.parse(connector.expiresAt) <= Date.now()) {
        connector.state = "offline";
        this.markSnapshotsStale(state, workspaceId, connector);
        changed = true;
      }
    return changed;
  }
  private assertRepositoryMembership(
    state: HostedState,
    workspaceId: string,
    repositoryId: unknown
  ): void {
    this.normalizeExpiredConnectors(state, workspaceId);
    if (
      typeof repositoryId !== "string" ||
      !(state.repositories[workspaceId] ?? []).some((repository) => repository.id === repositoryId)
    )
      throw new HostedDomainError("NOT_FOUND", "Repository not found.");
  }
  private async assertRepository(
    userId: string,
    workspaceId: string,
    repositoryId: string
  ): Promise<void> {
    await this.assertWorkspace(userId, workspaceId);
    const state = await this.read();
    this.assertRepositoryMembership(state, workspaceId, repositoryId);
  }
  private assertConnectorRepository(
    state: HostedState,
    connector: HostedConnector,
    workspaceId: string,
    repositoryId: string
  ): void {
    if (connector.workspaceId !== workspaceId)
      throw new HostedDomainError("FORBIDDEN", "Connector access denied.");
    this.assertRepositoryMembership(state, workspaceId, repositoryId);
  }
  private pathAllowed(
    repositoryRoot: string,
    allowedPaths: string[] | undefined,
    requestedPath: string | undefined
  ): boolean {
    if (!allowedPaths?.length || !requestedPath) return false;
    try {
      const canonical = this.assertWithinRepository(repositoryRoot, requestedPath);
      return allowedPaths.some((path) => canonical === path || canonical.startsWith(`${path}/`));
    } catch {
      return false;
    }
  }
  private canonicalPath(path: string): string {
    if (!path.trim()) throw new HostedDomainError("INVALID", "Repository path is required.");
    const resolved = resolve(path);
    const canonical = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
    return canonical.replaceAll("\\", "/").replace(/\/$/, "");
  }
  private assertWithinRepository(repositoryRoot: string, path: string): string {
    const root = this.canonicalPath(repositoryRoot);
    const candidate = this.canonicalPath(path);
    const remainder = relative(root, candidate).replaceAll("\\", "/");
    if (isAbsolute(remainder) || remainder === ".." || remainder.startsWith("../"))
      throw new HostedDomainError("FORBIDDEN", "Filesystem path is outside the repository root.");
    return candidate;
  }
  private async externalizeArtifact(
    value: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const content = value.content;
    const object = await this.objectStore.put(JSON.stringify(content), "application/json");
    const metadata = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content"));
    return {
      ...metadata,
      objectReference: object.reference,
      objectContentType: object.contentType,
      objectSize: object.size,
    };
  }
  private publicCredential(credential: HostedCredentialRecord): HostedCredentialMetadata {
    return {
      id: credential.id,
      provider: credential.provider,
      scopes: [...credential.scopes],
      status: credential.status,
      expiresAt: credential.expiresAt,
      identity: credential.identity,
      health: credential.health,
      createdAt: credential.createdAt,
    };
  }
  private async auditEvent(
    state: HostedState,
    userId: string,
    workspaceId: string | undefined,
    action: string,
    subjectId?: string,
    repositoryId?: string,
    capability?: string,
    outcome?: "allowed" | "denied"
  ): Promise<void> {
    state.audit.push({
      id: randomUUID(),
      userId,
      ...(workspaceId ? { workspaceId } : {}),
      action,
      ...(subjectId ? { subjectId } : {}),
      ...(repositoryId ? { repositoryId } : {}),
      ...(capability ? { capability } : {}),
      ...(outcome ? { outcome } : {}),
      occurredAt: new Date().toISOString(),
    });
  }
  private withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.provider.withMutationLock
      ? this.provider.withMutationLock(operation)
      : withStateLock(this.root, operation);
  }
  private read(): Promise<HostedState> {
    return this.provider.read();
  }
  private write(state: HostedState): Promise<void> {
    return this.provider.write(state);
  }
  private async readDeploymentState(state?: HostedState): Promise<HostedDeploymentState> {
    if (this.provider.readDeploymentState) return this.provider.readDeploymentState();
    const source = state ?? (await this.read());
    return {
      vercelProject: source.vercelProject ?? null,
      vercelProjectHistory: source.vercelProjectHistory ?? [],
      githubRepositories: source.githubRepositories ?? [],
    };
  }
  private writeDeploymentState(
    state: HostedState,
    deploymentState: HostedDeploymentState
  ): Promise<void> {
    if (this.provider.writeDeploymentState)
      return this.provider.writeDeploymentState(deploymentState);
    state.vercelProject = deploymentState.vercelProject;
    state.vercelProjectHistory = deploymentState.vercelProjectHistory;
    state.githubRepositories = deploymentState.githubRepositories;
    return Promise.resolve();
  }
}

const tenantDomainStores = new Map<string, HostedDomainStore>();

export function hostedDomainStoreForTenant(tenantId: string): HostedDomainStore {
  const existing = tenantDomainStores.get(tenantId);
  if (existing) return existing;
  const workspaceStore = hostedWorkspaceStoreForTenant(tenantId);
  if (isHostedNeonConfigured() && !isHostedJsonFixtureMode()) {
    const secretStore: ProtectedSecretStore = process.env.DEV_AGENTIC_OS_SECRET_KEY
      ? new EncryptedProtectedSecretStore()
      : {
          put: async () => {
            throw new HostedDomainError(
              "FORBIDDEN",
              "Credential mutations require DEV_AGENTIC_OS_SECRET_KEY."
            );
          },
        };
    const store = new HostedDomainStore(
      process.cwd(),
      workspaceStore,
      new NeonHostedStateProvider(tenantId),
      new RejectingHostedObjectStore(),
      undefined,
      secretStore,
      tenantId
    );
    tenantDomainStores.set(tenantId, store);
    return store;
  }
  if (!isHostedJsonFixtureMode()) assertHostedProductionPersistenceConfigured();
  const tenantRoot = join(
    process.cwd(),
    ".developer-agentic-os",
    "tenants",
    createHash("sha256").update(tenantId).digest("hex")
  );
  const store = new HostedDomainStore(
    tenantRoot,
    workspaceStore,
    undefined,
    undefined,
    undefined,
    undefined,
    tenantId
  );
  tenantDomainStores.set(tenantId, store);
  return store;
}

export const hostedDomainStore = hostedDomainStoreForTenant("legacy");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecordMaps(
  left: Record<string, Array<Record<string, unknown>>>,
  right: HostedRecordMap
): HostedRecordMap {
  const result: HostedRecordMap = {};
  for (const kind of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const records = [...(left[kind] ?? []), ...(right[kind as HostedRecordKind] ?? [])];
    const seen = new Set<string>();
    result[kind as HostedRecordKind] = records.filter((record) => {
      const key =
        typeof record.externalId === "string"
          ? `external:${record.externalId}`
          : typeof record.id === "string"
            ? `id:${record.id}`
            : `value:${JSON.stringify(record)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return result;
}

function mergeRelationships(
  left: Array<{ from: string; to: string; kind: string }>,
  right: Array<{ from: string; to: string; kind: string }>
): Array<{ from: string; to: string; kind: string }> {
  const seen = new Set<string>();
  return [...left, ...right].filter((relationship) => {
    const key = `${relationship.from}:${relationship.to}:${relationship.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
