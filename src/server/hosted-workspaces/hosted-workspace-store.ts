import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import type {
  HostedAuditEvent,
  HostedIdentity,
  HostedWorkspace,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
} from "@/types/hosted-workspace";
import { currentCorrelationId } from "../hosted-api/context";
import { readJsonFile, writeJsonFile } from "../local-store/json-file";
import { withStateLock } from "../local-store/state-lock";
import {
  assertHostedProductionPersistenceConfigured,
  isHostedJsonFixtureMode,
  isHostedNeonConfigured,
  NeonHostedWorkspaceStateProvider,
} from "../hosted-persistence/neon-hosted-provider";
import { assertHostedInternalOwnerEnabled } from "../hosted-flags/feature-flags";

type HostedUserState = {
  workspaces: HostedWorkspace[];
  activeWorkspaceId: string | null;
};

export type HostedWorkspaceState = {
  workspaces?: Record<string, HostedWorkspace>;
  members?: Record<string, WorkspaceMember[]>;
  invitations?: Record<string, WorkspaceInvitation[]>;
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
    readonly code: "INVALID_NAME" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "EXPIRED",
    message: string
  ) {
    super(message);
    this.name = "HostedWorkspaceError";
  }
}

function roleSatisfies(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  const levels: Record<WorkspaceRole, number> = {
    owner: 3,
    admin: 2,
    member: 1,
  };
  return levels[actual] >= levels[required];
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

  async get(userId: string, workspaceId: string): Promise<HostedWorkspace> {
    const state = await this.read();
    const user = this.user(state, userId);
    const workspace = user.workspaces.find((ws) => ws.id === workspaceId);
    if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
    return workspace;
  }

  async create(userId: string, name: string): Promise<HostedWorkspace> {
    assertHostedInternalOwnerEnabled();
    const trimmedName = name.trim();
    if (!trimmedName) throw new HostedWorkspaceError("INVALID_NAME", "Workspace name is required.");
    return this.mutate((state) => {
      const now = new Date().toISOString();
      const workspace: HostedWorkspace = {
        id: randomUUID(),
        ownerId: userId,
        name: trimmedName,
        createdAt: now,
      };
      state.workspaces ??= {};
      state.workspaces[workspace.id] = workspace;

      const members = (state.members ??= {});
      const wsMembers = (members[workspace.id] ??= []);
      wsMembers.push({
        workspaceId: workspace.id,
        userId,
        role: "owner",
        joinedAt: now,
      });

      const user = this.user(state, userId);
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
      const now = new Date().toISOString();
      const workspace: HostedWorkspace = {
        id: randomUUID(),
        ownerId: userId,
        name: "Personal",
        createdAt: now,
      };
      state.workspaces ??= {};
      state.workspaces[workspace.id] = workspace;

      const members = (state.members ??= {});
      const wsMembers = (members[workspace.id] ??= []);
      wsMembers.push({
        workspaceId: workspace.id,
        userId,
        role: "owner",
        joinedAt: now,
      });

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
    const workspace = state.workspaces?.[workspaceId];
    if (workspace) return workspace.ownerId === userId;
    return this.user(state, userId).workspaces.some(
      (ws) => ws.id === workspaceId && ws.ownerId === userId
    );
  }

  async owner(workspaceId: string): Promise<string> {
    const state = await this.read();
    if (state.workspaces?.[workspaceId]) {
      return state.workspaces[workspaceId].ownerId;
    }
    for (const user of Object.values(state.users)) {
      const match = user.workspaces.find((workspace) => workspace.id === workspaceId);
      if (match) return match.ownerId;
    }
    throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
  }

  async getRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const state = await this.read();
    const members = state.members?.[workspaceId] ?? [];
    const member = members.find((m) => m.userId === userId);
    if (member) return member.role;
    const user = this.user(state, userId);
    const ws = user.workspaces.find((w) => w.id === workspaceId);
    if (ws && ws.ownerId === userId) return "owner";
    return null;
  }

  async assertMember(
    userId: string,
    workspaceId: string,
    minRole?: WorkspaceRole
  ): Promise<WorkspaceMember> {
    const state = await this.read();
    const members = state.members?.[workspaceId] ?? [];
    let member = members.find((m) => m.userId === userId);
    if (!member) {
      const user = this.user(state, userId);
      const ws = user.workspaces.find((w) => w.id === workspaceId);
      if (ws && ws.ownerId === userId) {
        member = {
          workspaceId,
          userId,
          role: "owner",
          joinedAt: ws.createdAt,
        };
      }
    }
    if (!member) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");

    if (minRole && !roleSatisfies(member.role, minRole)) {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        `This operation requires ${minRole} or higher role.`
      );
    }
    return member;
  }

  async listMembers(userId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    await this.assertMember(userId, workspaceId);
    const state = await this.read();
    return state.members?.[workspaceId] ?? [];
  }

  async listInvitations(userId: string, workspaceId: string): Promise<WorkspaceInvitation[]> {
    await this.assertMember(userId, workspaceId, "admin");
    const state = await this.read();
    const list = state.invitations?.[workspaceId] ?? [];
    const now = Date.now();
    for (const inv of list) {
      if (inv.status === "pending" && Date.parse(inv.expiresAt) <= now) {
        inv.status = "expired";
      }
    }
    return list;
  }

  async createInvitation(
    userId: string,
    workspaceId: string,
    input: {
      recipientEmail: string;
      role: "admin" | "member";
      expiresInSeconds?: number;
    }
  ): Promise<WorkspaceInvitation> {
    await this.assertMember(userId, workspaceId, "admin");
    const email = input.recipientEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new HostedWorkspaceError("INVALID_NAME", "Valid recipient email is required.");
    }
    if (input.role !== "admin" && input.role !== "member") {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        "Workspaces can have exactly one owner. Invitations cannot assign owner role."
      );
    }

    return this.mutate((state) => {
      const invitations = (state.invitations ??= {});
      const wsInvitations = (invitations[workspaceId] ??= []);
      const expiresInSec = input.expiresInSeconds ?? 7 * 24 * 3600;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiresInSec * 1000).toISOString();

      const invitation: WorkspaceInvitation = {
        id: randomUUID(),
        workspaceId,
        recipientEmail: email,
        role: input.role,
        status: "pending",
        invitedBy: userId,
        createdAt: now.toISOString(),
        expiresAt,
      };
      wsInvitations.push(invitation);
      state.audit.push(this.event("invitation.created", userId, workspaceId));
      return invitation;
    });
  }

  async revokeInvitation(
    userId: string,
    invitationId: string,
    workspaceId?: string
  ): Promise<WorkspaceInvitation> {
    const state = await this.read();
    let targetWsId = workspaceId;
    if (!targetWsId) {
      for (const [wsId, invList] of Object.entries(state.invitations ?? {})) {
        if (invList.some((item) => item.id === invitationId)) {
          targetWsId = wsId;
          break;
        }
      }
    }
    if (!targetWsId) throw new HostedWorkspaceError("NOT_FOUND", "Invitation not found.");
    await this.assertMember(userId, targetWsId, "admin");

    return this.mutate((s) => {
      const wsInvitations = s.invitations?.[targetWsId!] ?? [];
      const invitation = wsInvitations.find((item) => item.id === invitationId);
      if (!invitation) throw new HostedWorkspaceError("NOT_FOUND", "Invitation not found.");
      if (invitation.status === "revoked") return invitation;
      if (invitation.status === "accepted") {
        throw new HostedWorkspaceError(
          "CONFLICT",
          "Cannot revoke an invitation that has already been accepted."
        );
      }
      invitation.status = "revoked";
      invitation.revokedAt = new Date().toISOString();
      invitation.revokedBy = userId;
      s.audit.push(this.event("invitation.revoked", userId, targetWsId));
      return invitation;
    });
  }

  async acceptInvitation(
    userId: string,
    invitationId: string,
    userEmail?: string
  ): Promise<{ workspace: HostedWorkspace; member: WorkspaceMember }> {
    return this.mutate((state) => {
      let foundInvitation: WorkspaceInvitation | null = null;
      let targetWorkspaceId: string | null = null;
      for (const [wsId, invList] of Object.entries(state.invitations ?? {})) {
        const inv = invList.find((item) => item.id === invitationId);
        if (inv) {
          foundInvitation = inv;
          targetWorkspaceId = wsId;
          break;
        }
      }
      if (!foundInvitation || !targetWorkspaceId) {
        throw new HostedWorkspaceError("NOT_FOUND", "Invitation not found.");
      }

      const workspace = state.workspaces?.[targetWorkspaceId];
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");

      if (foundInvitation.status === "accepted") {
        if (foundInvitation.acceptedBy === userId) {
          const members = state.members?.[targetWorkspaceId] ?? [];
          const existingMember = members.find((m) => m.userId === userId);
          if (existingMember) return { workspace, member: existingMember };
        }
        throw new HostedWorkspaceError(
          "CONFLICT",
          "Invitation has already been accepted by another user."
        );
      }

      if (foundInvitation.status === "revoked") {
        throw new HostedWorkspaceError("CONFLICT", "Invitation has been revoked.");
      }

      if (Date.now() >= Date.parse(foundInvitation.expiresAt)) {
        foundInvitation.status = "expired";
        state.audit.push(this.event("invitation.expired", userId, targetWorkspaceId));
        throw new HostedWorkspaceError("EXPIRED", "Invitation has expired.");
      }

      if (
        userEmail &&
        userEmail.trim().toLowerCase() !== foundInvitation.recipientEmail.toLowerCase()
      ) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "This invitation was sent to a different email address."
        );
      }

      const now = new Date().toISOString();
      const members = (state.members ??= {});
      const wsMembers = (members[targetWorkspaceId] ??= []);
      let member = wsMembers.find((m) => m.userId === userId);
      if (!member) {
        member = {
          workspaceId: targetWorkspaceId,
          userId,
          role: foundInvitation.role,
          joinedAt: now,
        };
        wsMembers.push(member);
      } else {
        member.role = foundInvitation.role;
      }

      const user = this.user(state, userId);
      if (!user.workspaces.some((ws) => ws.id === workspace.id)) {
        user.workspaces.push(workspace);
      }
      user.activeWorkspaceId ??= workspace.id;

      foundInvitation.status = "accepted";
      foundInvitation.acceptedAt = now;
      foundInvitation.acceptedBy = userId;

      state.audit.push(this.event("invitation.accepted", userId, targetWorkspaceId));
      return { workspace, member };
    });
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    targetUserId: string,
    newRole: "admin" | "member"
  ): Promise<WorkspaceMember> {
    const caller = await this.assertMember(userId, workspaceId, "admin");
    return this.mutate((state) => {
      const workspace = state.workspaces?.[workspaceId];
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");

      if (targetUserId === workspace.ownerId) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Cannot alter the role of the workspace owner."
        );
      }
      if (newRole !== "admin" && newRole !== "member") {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Workspaces can have exactly one owner. Cannot assign owner role."
        );
      }

      const members = state.members?.[workspaceId] ?? [];
      const targetMember = members.find((m) => m.userId === targetUserId);
      if (!targetMember) throw new HostedWorkspaceError("NOT_FOUND", "Member not found.");

      if (caller.role !== "owner" && targetMember.role === "admin" && targetUserId !== userId) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only the owner can alter another admin's role."
        );
      }

      targetMember.role = newRole;
      state.audit.push(this.event("member.role_updated", userId, workspaceId));
      return targetMember;
    });
  }

  async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    const caller = await this.assertMember(userId, workspaceId);
    return this.mutate((state) => {
      const workspace = state.workspaces?.[workspaceId];
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");

      if (targetUserId === workspace.ownerId) {
        throw new HostedWorkspaceError("FORBIDDEN", "Cannot remove the workspace owner.");
      }

      const members = state.members?.[workspaceId] ?? [];
      const targetIndex = members.findIndex((m) => m.userId === targetUserId);
      if (targetIndex === -1) throw new HostedWorkspaceError("NOT_FOUND", "Member not found.");
      const targetMember = members[targetIndex];

      if (caller.userId !== targetUserId) {
        if (caller.role === "member") {
          throw new HostedWorkspaceError("FORBIDDEN", "Members cannot remove other members.");
        }
        if (caller.role === "admin" && targetMember.role === "admin") {
          throw new HostedWorkspaceError("FORBIDDEN", "Only the owner can remove an admin.");
        }
      }

      members.splice(targetIndex, 1);
      const targetUser = state.users[targetUserId];
      if (targetUser) {
        targetUser.workspaces = targetUser.workspaces.filter((ws) => ws.id !== workspaceId);
        if (targetUser.activeWorkspaceId === workspaceId) {
          targetUser.activeWorkspaceId = targetUser.workspaces[0]?.id ?? null;
        }
      }

      state.audit.push(this.event("member.removed", userId, workspaceId));
    });
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
    workspaceId?: string,
    correlationId?: string
  ): HostedAuditEvent {
    const resolvedCorrelationId = correlationId ?? currentCorrelationId();
    return {
      id: randomUUID(),
      action,
      userId,
      ...(workspaceId ? { workspaceId } : {}),
      ...(resolvedCorrelationId ? { correlationId: resolvedCorrelationId } : {}),
      occurredAt: new Date().toISOString(),
    };
  }

  private normalizeState(state: HostedWorkspaceState): HostedWorkspaceState {
    state.workspaces ??= {};
    state.members ??= {};
    state.invitations ??= {};
    state.users ??= {};
    state.audit ??= [];

    for (const userState of Object.values(state.users)) {
      for (const ws of userState.workspaces) {
        state.workspaces[ws.id] ??= ws;
        const members = (state.members[ws.id] ??= []);
        if (!members.some((m) => m.userId === ws.ownerId)) {
          members.push({
            workspaceId: ws.id,
            userId: ws.ownerId,
            role: "owner",
            joinedAt: ws.createdAt,
          });
        }
      }
    }

    for (const [wsId, members] of Object.entries(state.members)) {
      const ws = state.workspaces[wsId];
      if (!ws) continue;
      for (const m of members) {
        const u = (state.users[m.userId] ??= { workspaces: [], activeWorkspaceId: null });
        if (!u.workspaces.some((w) => w.id === wsId)) {
          u.workspaces.push(ws);
        }
      }
    }

    return state;
  }

  private async read(): Promise<HostedWorkspaceState> {
    if (this.provider) {
      const raw = await this.provider.read();
      return this.normalizeState(raw);
    }
    this.assertFixtureOnly();
    const raw = await readJsonFile(this.path, { users: {}, audit: [] });
    return this.normalizeState(raw);
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

export function setHostedWorkspaceStoreForTenant(
  tenantId: string,
  store: HostedWorkspaceStore | null
): void {
  if (store) {
    tenantWorkspaceStores.set(tenantId, store);
  } else {
    tenantWorkspaceStores.delete(tenantId);
  }
}

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
  if (!isHostedJsonFixtureMode()) assertHostedProductionPersistenceConfigured();
  const store = new HostedWorkspaceStore(tenantRoot);
  tenantWorkspaceStores.set(tenantId, store);
  return store;
}

export const hostedWorkspaceStore = new Proxy({} as HostedWorkspaceStore, {
  get(_target, property, receiver) {
    const store = hostedWorkspaceStoreForTenant("legacy");
    const value = Reflect.get(store as object, property, receiver);
    return typeof value === "function" ? value.bind(store) : value;
  },
});
