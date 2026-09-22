export type HostedIdentity = {
  userId: string;
  tenantId: string;
  displayName: string;
  orgRole?: "org:admin" | "org:member";
};

export type WorkspaceStatus = "active" | "tombstoned";

export type WorkspaceRecoveryInfo = {
  recoveryBackupId: string;
  backupChecksum: string;
  deletedAt: string;
  deletedBy: string;
  retentionWindowDays: number;
  runbook: string;
  restoreSeam: string;
  retainedSnapshot?: string;
};

export type HostedWorkspace = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  status?: WorkspaceStatus;
  deletedAt?: string;
  recoveryBackupId?: string;
  recoveryInfo?: WorkspaceRecoveryInfo;
};

export type WorkspaceRole = "owner" | "admin" | "member";

export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
};

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  recipientEmail: string;
  role: "admin" | "member";
  status: InvitationStatus;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type ProtectedAction =
  | "ownership.transfer"
  | "workspace.delete"
  | "workspace.restore"
  | "domain.export_full"
  | "policy.update";

export type ApprovalStatus = "pending" | "consumed" | "revoked" | "expired";

export type WorkspaceApproval = {
  id: string;
  tenantId?: string;
  workspaceId: string;
  actorId: string;
  action: ProtectedAction;
  target: string;
  version: string;
  reason: string;
  correlationId: string;
  approvedBy: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  consumedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type WorkspacePolicy = {
  workspaceId: string;
  requireApprovalForDelete: boolean;
  requireApprovalForExport: boolean;
  requireApprovalForTransfer: boolean;
  approvalExpiryWindowSeconds: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type HostedAuditAction =
  | "identity.authenticated"
  | "workspace.created"
  | "workspace.listed"
  | "workspace.selected"
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "invitation.expired"
  | "member.role_updated"
  | "member.removed"
  | "approval.created"
  | "approval.revoked"
  | "approval.consumed"
  | "approval.expired"
  | "workspace.ownership_transferred"
  | "workspace.deleted"
  | "workspace.restored"
  | "policy.updated";

export type HostedAuditEvent = {
  id: string;
  action: HostedAuditAction;
  userId: string;
  workspaceId?: string;
  correlationId?: string;
  occurredAt: string;
};
