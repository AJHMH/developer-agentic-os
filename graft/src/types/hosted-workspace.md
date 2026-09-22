# src/types/hosted-workspace.ts

- HostedIdentity · type · L1-L6 — type HostedIdentity = { userId: string; tenantId: string; displayName: string; orgRole?: "org:admin" | "org:member"; };
- WorkspaceStatus · type · L8-L8 — type WorkspaceStatus = "active" | "tombstoned";
- WorkspaceRecoveryInfo · type · L10-L19 — type WorkspaceRecoveryInfo = { recoveryBackupId: string; backupChecksum: string; deletedAt: string; deletedBy: string; retentionWindowDays: number; runbook: string; restoreSeam: string; retainedSnapshot?: string; };
- HostedWorkspace · type · L21-L30 — type HostedWorkspace = { id: string; ownerId: string; name: string; createdAt: string; status?: WorkspaceStatus; deletedAt?: string; recoveryBackupId?: string; recoveryInfo?: WorkspaceRecoveryInfo; };
- WorkspaceRole · type · L32-L32 — type WorkspaceRole = "owner" | "admin" | "member";
- WorkspaceMember · type · L34-L39 — type WorkspaceMember = { workspaceId: string; userId: string; role: WorkspaceRole; joinedAt: string; };
- InvitationStatus · type · L41-L41 — type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
- WorkspaceInvitation · type · L43-L56 — type WorkspaceInvitation = { id: string; workspaceId: string; recipientEmail: string; role: "admin" | "member"; status: InvitationStatus; invitedBy: string; createdAt: string; expiresAt: string; acceptedAt?: string; acceptedBy?: string; revokedAt?: string; revokedBy?: string; };
- ProtectedAction · type · L58-L63 — type ProtectedAction = | "ownership.transfer" | "workspace.delete" | "workspace.restore" | "domain.export_full" | "policy.update";
- ApprovalStatus · type · L65-L65 — type ApprovalStatus = "pending" | "consumed" | "revoked" | "expired";
- WorkspaceApproval · type · L67-L85 — type WorkspaceApproval = { id: string; tenantId?: string; workspaceId: string; actorId: string; action: ProtectedAction; target: string; version: string; reason: string; correlationId: string; approvedBy: string; status: ApprovalStatus; createdAt: string; expiresAt: string; consumedAt?: string; consumedBy?: string; revokedAt?: string; revokedBy?: string; };
- WorkspacePolicy · type · L87-L96 — type WorkspacePolicy = { workspaceId: string; requireApprovalForDelete: boolean; requireApprovalForExport: boolean; requireApprovalForTransfer: boolean; approvalExpiryWindowSeconds: number; version: number; updatedAt: string; updatedBy: string; };
- HostedAuditAction · type · L98-L116 — type HostedAuditAction = | "identity.authenticated" | "workspace.created" | "workspace.listed" | "workspace.selected" | "invitation.created" | "invitation.accepted" | "invitation.revoked" | "invitation.expired" | "member.role_updated" | "member.removed" | "approval.created" | "approval.revoked" | "approval.consumed" | "approval.expired" | "workspace.ownership_transferred" | "workspace.deleted" | "workspace.restored" | "policy.updated";
- HostedAuditEvent · type · L118-L125 — type HostedAuditEvent = { id: string; action: HostedAuditAction; userId: string; workspaceId?: string; correlationId?: string; occurredAt: string; };
