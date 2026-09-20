# src/types/hosted-workspace.ts

- HostedIdentity · type · L1-L6 — type HostedIdentity = { userId: string; tenantId: string; displayName: string; orgRole?: "org:admin" | "org:member"; };
- HostedWorkspace · type · L8-L13 — type HostedWorkspace = { id: string; ownerId: string; name: string; createdAt: string; };
- HostedAuditAction · type · L15-L16 — type HostedAuditAction = "identity.authenticated" | "workspace.created" | "workspace.listed" | "workspace.selected";
- HostedAuditEvent · type · L18-L24 — type HostedAuditEvent = { id: string; action: HostedAuditAction; userId: string; workspaceId?: string; occurredAt: string; };
