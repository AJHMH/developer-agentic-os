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

export type HostedAuditAction =
  "identity.authenticated" | "workspace.created" | "workspace.listed" | "workspace.selected";

export type HostedAuditEvent = {
  id: string;
  action: HostedAuditAction;
  userId: string;
  workspaceId?: string;
  occurredAt: string;
};
