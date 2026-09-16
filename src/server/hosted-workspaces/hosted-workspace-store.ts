import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import type { HostedAuditEvent, HostedIdentity, HostedWorkspace } from "@/types/hosted-workspace";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { withStateLock } from "../local-store/state-lock";
import {
  isHostedJsonFixtureMode,
  isHostedNeonConfigured,
  NeonHostedWorkspaceStateProvider,
} from "../hosted-persistence/neon-hosted-provider";

type HostedUserState = {
  workspaces: HostedWorkspace[];
  activeWorkspaceId: string | null;
};

export type HostedWorkspaceState = {
  users: Record<string, HostedUserState>;
  audit: HostedAuditEvent[];
};

export interface HostedWorkspaceStateProvider {
  read(): Promise<HostedWorkspaceState>;
  write(state: HostedWorkspaceState): Promise<void>;
  withMutationLock?<T>(operation: () => Promise<T>): Promise<T>;
}

export class HostedWorkspaceError extends Error {
  constructor(
    readonly code: "INVALID_NAME" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "HostedWorkspaceError";
  }
}

export class HostedWorkspaceStore {
  private readonly path: string;
  private readonly root: string;

  constructor(
    root = process.cwd(),
    private readonly provider?: HostedWorkspaceStateProvider
  ) {
    this.root = resolve(root);
    this.path = join(resolve(root), ".developer-agentic-os", "hosted-workspaces.json");
  }

  async list(userId: string): Promise<HostedWorkspace[]> {
    const state = await this.read();
    return this.user(state, userId).workspaces;
  }

  async create(userId: string, name: string): Promise<HostedWorkspace> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new HostedWorkspaceError("INVALID_NAME", "Workspace name is required.");
    return this.mutate((state) => {
      const user = this.user(state, userId);
      const workspace: HostedWorkspace = {
        id: randomUUID(),
        ownerId: userId,
        name: trimmedName,
        createdAt: new Date().toISOString(),
      };
      user.workspaces.push(workspace);
      user.activeWorkspaceId ??= workspace.id;
      state.audit.push(this.event("workspace.created", userId, workspace.id));
      return workspace;
    });
  }

  async ensureDefault(userId: string): Promise<HostedWorkspace> {
    return this.mutate((state) => {
      const user = this.user(state, userId);
      const activeWorkspace = user.workspaces.find(
        (workspace) => workspace.id === user.activeWorkspaceId
      );
      if (activeWorkspace) return activeWorkspace;
      if (user.workspaces[0]) {
        user.activeWorkspaceId = user.workspaces[0].id;
        return user.workspaces[0];
      }
      const workspace: HostedWorkspace = {
        id: randomUUID(),
        ownerId: userId,
        name: "Personal",
        createdAt: new Date().toISOString(),
      };
      user.workspaces.push(workspace);
      user.activeWorkspaceId = workspace.id;
      state.audit.push(this.event("workspace.created", userId, workspace.id));
      return workspace;
    });
  }

  async select(userId: string, workspaceId: string): Promise<HostedWorkspace> {
    return this.mutate((state) => {
      const workspace = this.user(state, userId).workspaces.find((item) => item.id === workspaceId);
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
      state.users[userId].activeWorkspaceId = workspaceId;
      state.audit.push(this.event("workspace.selected", userId, workspaceId));
      return workspace;
    });
  }

  async active(userId: string): Promise<HostedWorkspace | null> {
    const state = await this.read();
    const user = this.user(state, userId);
    return user.workspaces.find((workspace) => workspace.id === user.activeWorkspaceId) ?? null;
  }

  async owns(userId: string, workspaceId: string): Promise<boolean> {
    const state = await this.read();
    return this.user(state, userId).workspaces.some((workspace) => workspace.id === workspaceId);
  }

  async owner(workspaceId: string): Promise<string> {
    const state = await this.read();
    for (const user of Object.values(state.users)) {
      if (user.workspaces.some((workspace) => workspace.id === workspaceId))
        return user.workspaces.find((workspace) => workspace.id === workspaceId)!.ownerId;
    }
    throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
  }

  async recordIdentity(identity: HostedIdentity): Promise<void> {
    await this.mutate((state) => {
      this.user(state, identity.userId);
      state.audit.push(this.event("identity.authenticated", identity.userId));
    });
  }

  async recordList(userId: string): Promise<void> {
    await this.mutate((state) => {
      this.user(state, userId);
      state.audit.push(this.event("workspace.listed", userId));
    });
  }

  async audit(userId: string): Promise<HostedAuditEvent[]> {
    const state = await this.read();
    return state.audit.filter((event) => event.userId === userId);
  }

  private user(state: HostedWorkspaceState, userId: string): HostedUserState {
    return (
      state.users[userId] ?? (state.users[userId] = { workspaces: [], activeWorkspaceId: null })
    );
  }

  private event(
    action: HostedAuditEvent["action"],
    userId: string,
    workspaceId?: string
  ): HostedAuditEvent {
    return {
      id: randomUUID(),
      action,
      userId,
      ...(workspaceId ? { workspaceId } : {}),
      occurredAt: new Date().toISOString(),
    };
  }

  private read(): Promise<HostedWorkspaceState> {
    if (this.provider) return this.provider.read();
    this.assertFixtureOnly();
    return readJsonFile(this.path, { users: {}, audit: [] });
  }

  private write(state: HostedWorkspaceState): Promise<void> {
    if (this.provider) return this.provider.write(state);
    this.assertFixtureOnly();
    return writeJsonFile(this.path, state);
  }

  private async mutate<T>(operation: (state: HostedWorkspaceState) => T | Promise<T>): Promise<T> {
    if (!this.provider) this.assertFixtureOnly();
    const mutateState = async () => {
      const state = await this.read();
      const result = await operation(state);
      await this.write(state);
      return result;
    };
    if (this.provider?.withMutationLock) return this.provider.withMutationLock(mutateState);
    return withStateLock(this.root, mutateState);
  }

  private assertFixtureOnly(): void {
    if (
      (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") ||
      process.env.HOSTED_JSON_FIXTURE_MODE !== "true"
    )
      throw new HostedWorkspaceError(
        "NOT_FOUND",
        "The deterministic JSON hosted backend is fixture-only; configure a transactional hosted state provider for production."
      );
  }
}

const tenantWorkspaceStores = new Map<string, HostedWorkspaceStore>();

export function hostedWorkspaceStoreForTenant(tenantId: string): HostedWorkspaceStore {
  const existing = tenantWorkspaceStores.get(tenantId);
  if (existing) return existing;
  const tenantRoot = join(
    process.cwd(),
    ".developer-agentic-os",
    "tenants",
    createHash("sha256").update(tenantId).digest("hex")
  );
  if (isHostedNeonConfigured() && !isHostedJsonFixtureMode()) {
    const store = new HostedWorkspaceStore(
      process.cwd(),
      new NeonHostedWorkspaceStateProvider(tenantId)
    );
    tenantWorkspaceStores.set(tenantId, store);
    return store;
  }
  const store = new HostedWorkspaceStore(tenantRoot);
  tenantWorkspaceStores.set(tenantId, store);
  return store;
}

export const hostedWorkspaceStore = hostedWorkspaceStoreForTenant("legacy");
