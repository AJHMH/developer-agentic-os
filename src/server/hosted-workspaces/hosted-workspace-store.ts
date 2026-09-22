import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import type {
  HostedAuditEvent,
  HostedIdentity,
  HostedWorkspace,
  ProtectedAction,
  WorkspaceApproval,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspacePolicy,
  WorkspaceRecoveryInfo,
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
import {
  assertHostedInternalOwnerEnabled,
  isHostedCollaboratorRolloutEnabled,
} from "../hosted-flags/feature-flags";

type HostedUserState = {
  workspaces: HostedWorkspace[];
  activeWorkspaceId: string | null;
};

export type HostedWorkspaceState = {
  workspaces?: Record<string, HostedWorkspace>;
  members?: Record<string, WorkspaceMember[]>;
  invitations?: Record<string, WorkspaceInvitation[]>;
  approvals?: Record<string, WorkspaceApproval[]>;
  policies?: Record<string, WorkspacePolicy>;
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
    readonly code: "INVALID_NAME" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "EXPIRED" | "STALE",
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
    return this.user(state, userId).workspaces.filter((ws) => ws.status !== "tombstoned");
  }

  async get(
    userId: string,
    workspaceId: string,
    options?: { includeTombstoned?: boolean }
  ): Promise<HostedWorkspace> {
    const state = await this.read();
    const user = this.user(state, userId);
    const workspace = user.workspaces.find((ws) => ws.id === workspaceId);
    if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
    if (workspace.status === "tombstoned" && !options?.includeTombstoned) {
      throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
    }
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
        status: "active",
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

      const policies = (state.policies ??= {});
      policies[workspace.id] = {
        workspaceId: workspace.id,
        requireApprovalForDelete: true,
        requireApprovalForExport: true,
        requireApprovalForTransfer: true,
        approvalExpiryWindowSeconds: 3600,
        version: 1,
        updatedAt: now,
        updatedBy: userId,
      };

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
        (workspace) => workspace.id === user.activeWorkspaceId && workspace.status !== "tombstoned"
      );
      if (activeWorkspace) return activeWorkspace;
      const firstActive = user.workspaces.find((ws) => ws.status !== "tombstoned");
      if (firstActive) {
        user.activeWorkspaceId = firstActive.id;
        return firstActive;
      }
      const now = new Date().toISOString();
      const workspace: HostedWorkspace = {
        id: randomUUID(),
        ownerId: userId,
        name: "Personal",
        createdAt: now,
        status: "active",
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

      const policies = (state.policies ??= {});
      policies[workspace.id] = {
        workspaceId: workspace.id,
        requireApprovalForDelete: true,
        requireApprovalForExport: true,
        requireApprovalForTransfer: true,
        approvalExpiryWindowSeconds: 3600,
        version: 1,
        updatedAt: now,
        updatedBy: userId,
      };

      user.workspaces.push(workspace);
      user.activeWorkspaceId = workspace.id;

      state.audit.push(this.event("workspace.created", userId, workspace.id));
      return workspace;
    });
  }

  async select(userId: string, workspaceId: string): Promise<HostedWorkspace> {
    return this.mutate((state) => {
      const workspace = this.user(state, userId).workspaces.find(
        (item) => item.id === workspaceId && item.status !== "tombstoned"
      );
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
      state.users[userId].activeWorkspaceId = workspaceId;
      state.audit.push(this.event("workspace.selected", userId, workspaceId));
      return workspace;
    });
  }

  async active(userId: string): Promise<HostedWorkspace | null> {
    const state = await this.read();
    const user = this.user(state, userId);
    const active = user.workspaces.find(
      (workspace) => workspace.id === user.activeWorkspaceId && workspace.status !== "tombstoned"
    );
    if (active) return active;
    return user.workspaces.find((ws) => ws.status !== "tombstoned") ?? null;
  }

  async owns(userId: string, workspaceId: string): Promise<boolean> {
    const state = await this.read();
    const workspace = state.workspaces?.[workspaceId];
    if (workspace) return workspace.ownerId === userId && workspace.status !== "tombstoned";
    return this.user(state, userId).workspaces.some(
      (ws) => ws.id === workspaceId && ws.ownerId === userId && ws.status !== "tombstoned"
    );
  }

  async owner(workspaceId: string): Promise<string> {
    const state = await this.read();
    if (state.workspaces?.[workspaceId]) {
      if (state.workspaces[workspaceId].status === "tombstoned") {
        throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
      }
      return state.workspaces[workspaceId].ownerId;
    }
    for (const user of Object.values(state.users)) {
      const match = user.workspaces.find((workspace) => workspace.id === workspaceId);
      if (match) {
        if (match.status === "tombstoned") {
          throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
        }
        return match.ownerId;
      }
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
    minRole?: WorkspaceRole,
    options?: { includeTombstoned?: boolean }
  ): Promise<WorkspaceMember> {
    const state = await this.read();
    const ws = state.workspaces?.[workspaceId];
    if (ws && ws.status === "tombstoned" && !options?.includeTombstoned) {
      throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
    }
    const members = state.members?.[workspaceId] ?? [];
    let member = members.find((m) => m.userId === userId);
    if (!member) {
      const user = this.user(state, userId);
      const userWs = user.workspaces.find((w) => w.id === workspaceId);
      if (userWs && userWs.ownerId === userId) {
        member = {
          workspaceId,
          userId,
          role: "owner",
          joinedAt: userWs.createdAt,
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
    if (!isHostedCollaboratorRolloutEnabled()) {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        "Collaborator invitations are currently disabled."
      );
    }
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
    if (!isHostedCollaboratorRolloutEnabled()) {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        "Collaborator invitations are currently disabled."
      );
    }
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

  async transferOwnership(
    userId: string,
    workspaceId: string,
    targetUserId: string,
    options?: { approvalId?: string; version?: string }
  ): Promise<{ workspace: HostedWorkspace; previousOwnerId: string; newOwnerId: string }> {
    await this.assertMember(userId, workspaceId, "admin");
    return this.mutate((state) => {
      const workspace = state.workspaces?.[workspaceId];
      if (!workspace || workspace.status === "tombstoned") {
        throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
      }

      const members = state.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || (liveCaller.role !== "owner" && liveCaller.role !== "admin")) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only workspace owners or admins can transfer ownership."
        );
      }

      const policy = this.getPolicyInternal(state, workspaceId);
      if (liveCaller.role !== "owner") {
        if (policy.requireApprovalForTransfer) {
          if (!options?.approvalId) {
            throw new HostedWorkspaceError(
              "FORBIDDEN",
              "Admins require owner approval to transfer workspace ownership."
            );
          }
          this.consumeApprovalInternal(state, userId, workspaceId, options.approvalId, {
            action: "ownership.transfer",
            target: targetUserId,
            version: options?.version ?? String(workspace.createdAt || "v1"),
          });
        }
      }

      const targetMember = members.find((m) => m.userId === targetUserId);
      if (!targetMember) {
        throw new HostedWorkspaceError(
          "NOT_FOUND",
          "Target user must be a member of the workspace before receiving ownership."
        );
      }

      if (workspace.ownerId === targetUserId) {
        return {
          workspace,
          previousOwnerId: targetUserId,
          newOwnerId: targetUserId,
        };
      }

      const previousOwnerId = workspace.ownerId;
      // Normalize all non-target owners to admin to enforce single-owner invariant
      for (const m of members) {
        if (m.userId !== targetUserId && m.role === "owner") {
          m.role = "admin";
        }
      }

      targetMember.role = "owner";
      workspace.ownerId = targetUserId;

      // Update user.workspaces denormalized copies
      if (state.users) {
        for (const user of Object.values(state.users)) {
          const userWs = user.workspaces?.find((w) => w.id === workspaceId);
          if (userWs) {
            userWs.ownerId = targetUserId;
          }
        }
      }

      state.audit.push(this.event("workspace.ownership_transferred", userId, workspaceId));

      return {
        workspace,
        previousOwnerId,
        newOwnerId: targetUserId,
      };
    });
  }

  async softDeleteWorkspace(
    userId: string,
    workspaceId: string,
    options?: { approvalId?: string; version?: string }
  ): Promise<WorkspaceRecoveryInfo> {
    await this.assertMember(userId, workspaceId, "admin");
    return this.mutate((state) => {
      const workspace = state.workspaces?.[workspaceId];
      if (!workspace || workspace.status === "tombstoned") {
        throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
      }

      const members = state.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || (liveCaller.role !== "owner" && liveCaller.role !== "admin")) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only workspace owners or admins can delete the workspace."
        );
      }

      const policy = this.getPolicyInternal(state, workspaceId);
      if (liveCaller.role !== "owner") {
        if (policy.requireApprovalForDelete) {
          if (!options?.approvalId) {
            throw new HostedWorkspaceError(
              "FORBIDDEN",
              "Admins require owner approval to delete the workspace."
            );
          }
          this.consumeApprovalInternal(state, userId, workspaceId, options.approvalId, {
            action: "workspace.delete",
            target: workspaceId,
            version: options?.version ?? String(workspace.createdAt || "v1"),
          });
        }
      }

      const recoveryBackupId = randomUUID();
      const now = new Date().toISOString();
      const approvals = state.approvals?.[workspaceId] ?? [];
      const retainedSnapshot = JSON.stringify({
        workspace: {
          id: workspace.id,
          name: workspace.name,
          ownerId: workspace.ownerId,
          createdAt: workspace.createdAt,
          deletedAt: now,
          deletedBy: userId,
        },
        members,
        approvals,
        policy,
      });
      const backupChecksum = createHash("sha256").update(retainedSnapshot).digest("hex");

      const recoveryInfo: WorkspaceRecoveryInfo = {
        recoveryBackupId,
        backupChecksum,
        deletedAt: now,
        deletedBy: userId,
        retentionWindowDays: 30,
        runbook: "docs/runbooks/workspace-recovery.md",
        restoreSeam: `/api/hosted/workspaces/${workspaceId}/recovery`,
        retainedSnapshot,
      };

      workspace.status = "tombstoned";
      workspace.deletedAt = now;
      workspace.recoveryBackupId = recoveryBackupId;
      workspace.recoveryInfo = recoveryInfo;

      if (state.users) {
        for (const user of Object.values(state.users)) {
          const userWs = user.workspaces?.find((w) => w.id === workspaceId);
          if (userWs) {
            userWs.status = "tombstoned";
            userWs.deletedAt = now;
          }
          if (user.activeWorkspaceId === workspaceId) {
            const alternate = user.workspaces?.find(
              (w) => w.id !== workspaceId && w.status !== "tombstoned"
            );
            user.activeWorkspaceId = alternate?.id ?? null;
          }
        }
      }

      state.audit.push(this.event("workspace.deleted", userId, workspaceId));

      return recoveryInfo;
    });
  }

  async getWorkspaceRecovery(userId: string, workspaceId: string): Promise<WorkspaceRecoveryInfo> {
    await this.assertMember(userId, workspaceId, "admin", { includeTombstoned: true });
    const state = await this.read();
    const workspace = state.workspaces?.[workspaceId];
    if (!workspace || workspace.status !== "tombstoned" || !workspace.recoveryInfo) {
      throw new HostedWorkspaceError("NOT_FOUND", "Workspace recovery information not found.");
    }
    return workspace.recoveryInfo;
  }

  async restoreWorkspace(
    userId: string,
    workspaceId: string,
    options?: { approvalId?: string; version?: string }
  ): Promise<HostedWorkspace> {
    await this.assertMember(userId, workspaceId, "admin", {
      includeTombstoned: true,
    });
    return this.mutate((state) => {
      const workspace = state.workspaces?.[workspaceId];
      if (!workspace || workspace.status !== "tombstoned") {
        throw new HostedWorkspaceError("NOT_FOUND", "Tombstoned workspace not found.");
      }

      const members = state.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || (liveCaller.role !== "owner" && liveCaller.role !== "admin")) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only workspace owners or admins can restore a tombstoned workspace."
        );
      }

      // Check retention window
      const retentionDays = workspace.recoveryInfo?.retentionWindowDays ?? 30;
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      const deletedAtMs = new Date(
        workspace.deletedAt ?? workspace.recoveryInfo?.deletedAt ?? 0
      ).getTime();
      if (Date.now() - deletedAtMs > retentionMs) {
        throw new HostedWorkspaceError(
          "CONFLICT",
          "Workspace tombstone retention window has expired and cannot be restored."
        );
      }

      if (liveCaller.role !== "owner") {
        if (!options?.approvalId) {
          throw new HostedWorkspaceError(
            "FORBIDDEN",
            "Admins require owner approval to restore a tombstoned workspace."
          );
        }
        this.consumeApprovalInternal(state, userId, workspaceId, options.approvalId, {
          action: "workspace.restore",
          target: workspaceId,
          version: options?.version ?? String(workspace.createdAt || "v1"),
        });
      }

      workspace.status = "active";
      workspace.deletedAt = undefined;
      workspace.recoveryBackupId = undefined;
      workspace.recoveryInfo = undefined;

      if (state.users) {
        for (const user of Object.values(state.users)) {
          const userWs = user.workspaces?.find((w) => w.id === workspaceId);
          if (userWs) {
            userWs.status = "active";
            userWs.deletedAt = undefined;
          }
        }
      }

      const user = this.user(state, userId);
      user.activeWorkspaceId ??= workspace.id;

      state.audit.push(this.event("workspace.restored", userId, workspaceId));
      return workspace;
    });
  }

  async listApprovals(userId: string, workspaceId: string): Promise<WorkspaceApproval[]> {
    await this.assertMember(userId, workspaceId, "admin", { includeTombstoned: true });
    const state = await this.read();
    const approvals = state.approvals?.[workspaceId] ?? [];
    const now = Date.now();
    const hasExpired = approvals.some(
      (app) => app.status === "pending" && Date.parse(app.expiresAt) <= now
    );
    if (!hasExpired) {
      return approvals;
    }
    return this.mutate((s) => {
      const list = s.approvals?.[workspaceId] ?? [];
      const currentNow = Date.now();
      for (const app of list) {
        if (app.status === "pending" && Date.parse(app.expiresAt) <= currentNow) {
          app.status = "expired";
          s.audit.push(this.event("approval.expired", app.approvedBy, workspaceId));
        }
      }
      return list;
    });
  }

  async createApproval(
    userId: string,
    workspaceId: string,
    input: {
      actorId: string;
      action: ProtectedAction;
      target: string;
      version: string;
      reason: string;
      expiresInSeconds?: number;
    }
  ): Promise<WorkspaceApproval> {
    const caller = await this.assertMember(userId, workspaceId, undefined, {
      includeTombstoned: true,
    });
    if (caller.role !== "owner") {
      throw new HostedWorkspaceError("FORBIDDEN", "Only the workspace owner can create approvals.");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new HostedWorkspaceError("INVALID_NAME", "Approval reason is required.");
    }
    const validActions: ProtectedAction[] = [
      "ownership.transfer",
      "workspace.delete",
      "workspace.restore",
      "domain.export_full",
      "policy.update",
    ];
    if (!validActions.includes(input.action)) {
      throw new HostedWorkspaceError("INVALID_NAME", "Invalid protected action.");
    }
    if (!input.target?.trim() || !input.version?.trim()) {
      throw new HostedWorkspaceError("INVALID_NAME", "Target and version are required.");
    }

    return this.mutate((s) => {
      const members = s.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || liveCaller.role !== "owner") {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only the workspace owner can create approvals."
        );
      }
      const liveActor = members.find((m) => m.userId === input.actorId);
      if (!liveActor || liveActor.role !== "admin") {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Approvals can only be granted to active workspace admins."
        );
      }

      const now = new Date();
      const policy = s.policies?.[workspaceId];
      const expirySec = input.expiresInSeconds ?? policy?.approvalExpiryWindowSeconds ?? 3600;
      const expiresAt = new Date(now.getTime() + expirySec * 1000).toISOString();
      const approval: WorkspaceApproval = {
        id: randomUUID(),
        workspaceId,
        actorId: input.actorId,
        action: input.action,
        target: input.target.trim(),
        version: input.version.trim(),
        reason,
        correlationId: currentCorrelationId() ?? randomUUID(),
        approvedBy: userId,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt,
      };

      const approvals = (s.approvals ??= {});
      const list = (approvals[workspaceId] ??= []);
      list.push(approval);

      s.audit.push(this.event("approval.created", userId, workspaceId));
      return approval;
    });
  }

  async revokeApproval(
    userId: string,
    workspaceId: string,
    approvalId: string
  ): Promise<WorkspaceApproval> {
    await this.assertMember(userId, workspaceId, undefined, { includeTombstoned: true });
    return this.mutate((s) => {
      const members = s.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || liveCaller.role !== "owner") {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only the workspace owner can revoke approvals."
        );
      }

      const list = s.approvals?.[workspaceId] ?? [];
      const approval = list.find((a) => a.id === approvalId);
      if (!approval) {
        throw new HostedWorkspaceError("NOT_FOUND", "Approval not found.");
      }
      if (approval.status === "consumed") {
        throw new HostedWorkspaceError(
          "CONFLICT",
          "Cannot revoke an approval that has already been consumed."
        );
      }
      if (approval.status === "revoked") return approval;

      approval.status = "revoked";
      approval.revokedAt = new Date().toISOString();
      approval.revokedBy = userId;

      s.audit.push(this.event("approval.revoked", userId, workspaceId));
      return approval;
    });
  }

  async consumeApproval(
    callerUserId: string,
    workspaceId: string,
    approvalId: string,
    expected: {
      action: ProtectedAction;
      target: string;
      version: string;
    }
  ): Promise<WorkspaceApproval> {
    return this.mutate((s) => {
      return this.consumeApprovalInternal(s, callerUserId, workspaceId, approvalId, expected);
    });
  }

  consumeApprovalInternal(
    state: HostedWorkspaceState,
    callerUserId: string,
    workspaceId: string,
    approvalId: string,
    expected: {
      action: ProtectedAction;
      target: string;
      version: string;
    }
  ): WorkspaceApproval {
    const list = state.approvals?.[workspaceId] ?? [];
    const approval = list.find((a) => a.id === approvalId);
    if (!approval) {
      throw new HostedWorkspaceError("NOT_FOUND", "Approval not found.");
    }

    if (approval.actorId !== callerUserId) {
      throw new HostedWorkspaceError("FORBIDDEN", "Approval was granted to a different actor.");
    }

    if (approval.action !== expected.action) {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        `Approval action mismatch: cannot replay ${approval.action} approval for ${expected.action}.`
      );
    }

    if (approval.target !== expected.target) {
      throw new HostedWorkspaceError("FORBIDDEN", "Approval target mismatch.");
    }

    if (approval.status === "revoked" || approval.revokedAt) {
      throw new HostedWorkspaceError("CONFLICT", "Approval has been revoked.");
    }

    if (approval.status === "consumed" || approval.consumedAt) {
      throw new HostedWorkspaceError(
        "CONFLICT",
        "Approval has already been consumed and cannot be replayed."
      );
    }

    if (Date.now() >= Date.parse(approval.expiresAt)) {
      approval.status = "expired";
      state.audit.push(this.event("approval.expired", callerUserId, workspaceId));
      throw new HostedWorkspaceError("EXPIRED", "Approval has expired.");
    }

    if (!expected.version || approval.version !== expected.version) {
      throw new HostedWorkspaceError(
        "STALE",
        "Approval version mismatch. Resource state has changed."
      );
    }

    const currentOwner = state.workspaces?.[workspaceId]?.ownerId;
    if (currentOwner && currentOwner !== approval.approvedBy) {
      throw new HostedWorkspaceError(
        "FORBIDDEN",
        "Approval is stale because workspace ownership changed."
      );
    }

    approval.status = "consumed";
    approval.consumedAt = new Date().toISOString();
    approval.consumedBy = callerUserId;

    state.audit.push(this.event("approval.consumed", callerUserId, workspaceId));
    return approval;
  }

  private getPolicyInternal(state: HostedWorkspaceState, workspaceId: string): WorkspacePolicy {
    const workspace = state.workspaces?.[workspaceId];
    return (
      state.policies?.[workspaceId] ?? {
        workspaceId,
        requireApprovalForDelete: true,
        requireApprovalForExport: true,
        requireApprovalForTransfer: true,
        approvalExpiryWindowSeconds: 3600,
        version: 1,
        updatedAt: workspace?.createdAt ?? new Date().toISOString(),
        updatedBy: workspace?.ownerId ?? "system",
      }
    );
  }

  async getPolicy(userId: string, workspaceId: string): Promise<WorkspacePolicy> {
    await this.assertMember(userId, workspaceId);
    const state = await this.read();
    const workspace = state.workspaces?.[workspaceId];
    if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");
    return this.getPolicyInternal(state, workspaceId);
  }

  async updatePolicy(
    userId: string,
    workspaceId: string,
    updates: Partial<
      Pick<
        WorkspacePolicy,
        | "requireApprovalForDelete"
        | "requireApprovalForExport"
        | "requireApprovalForTransfer"
        | "approvalExpiryWindowSeconds"
      >
    >,
    options: { approvalId?: string; expectedVersion: number }
  ): Promise<WorkspacePolicy> {
    await this.assertMember(userId, workspaceId, "admin");
    return this.mutate((s) => {
      const workspace = s.workspaces?.[workspaceId];
      if (!workspace) throw new HostedWorkspaceError("NOT_FOUND", "Workspace not found.");

      const members = s.members?.[workspaceId] ?? [];
      const liveCaller = members.find((m) => m.userId === userId);
      if (!liveCaller || (liveCaller.role !== "owner" && liveCaller.role !== "admin")) {
        throw new HostedWorkspaceError(
          "FORBIDDEN",
          "Only workspace owners or admins can update workspace policy."
        );
      }

      const policies = (s.policies ??= {});
      const current = policies[workspaceId] ?? {
        workspaceId,
        requireApprovalForDelete: true,
        requireApprovalForExport: true,
        requireApprovalForTransfer: true,
        approvalExpiryWindowSeconds: 3600,
        version: 1,
        updatedAt: workspace.createdAt,
        updatedBy: workspace.ownerId,
      };

      if (options.expectedVersion === undefined || current.version !== options.expectedVersion) {
        throw new HostedWorkspaceError("STALE", "Policy version mismatch. Reload and retry.");
      }

      if (liveCaller.role !== "owner") {
        if (!options?.approvalId) {
          throw new HostedWorkspaceError(
            "FORBIDDEN",
            "Admins require owner approval to change audit/approval policy."
          );
        }
        this.consumeApprovalInternal(s, userId, workspaceId, options.approvalId, {
          action: "policy.update",
          target: workspaceId,
          version: String(options.expectedVersion),
        });
      }

      if (updates.approvalExpiryWindowSeconds !== undefined) {
        if (
          typeof updates.approvalExpiryWindowSeconds !== "number" ||
          updates.approvalExpiryWindowSeconds < 60 ||
          updates.approvalExpiryWindowSeconds > 7 * 24 * 3600
        ) {
          throw new HostedWorkspaceError(
            "INVALID_NAME",
            "approvalExpiryWindowSeconds must be between 60 and 604800 seconds."
          );
        }
      }

      const updated: WorkspacePolicy = {
        workspaceId,
        requireApprovalForDelete:
          updates.requireApprovalForDelete ?? current.requireApprovalForDelete,
        requireApprovalForExport:
          updates.requireApprovalForExport ?? current.requireApprovalForExport,
        requireApprovalForTransfer:
          updates.requireApprovalForTransfer ?? current.requireApprovalForTransfer,
        approvalExpiryWindowSeconds:
          updates.approvalExpiryWindowSeconds ?? current.approvalExpiryWindowSeconds,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      };

      policies[workspaceId] = updated;
      s.audit.push(this.event("policy.updated", userId, workspaceId));
      return updated;
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
    state.approvals ??= {};
    state.policies ??= {};
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
