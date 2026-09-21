export type HostedIdentity = {
  userId: string;
  tenantId: string;
  displayName: string;
  orgRole?: "org:admin" | "org:member";
};

export type HostedWorkspace = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
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
  | "member.removed";

export type HostedAuditEvent = {
  id: string;
  action: HostedAuditAction;
  userId: string;
  workspaceId?: string;
  correlationId?: string;
  occurredAt: string;
};
