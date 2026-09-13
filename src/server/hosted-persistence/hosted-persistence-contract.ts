export const hostedPersistenceContract = {
  name: "tenant-scoped-hosted-provider",
  version: 1,
  stateTables: ["developer_agentic_os_hosted_state", "developer_agentic_os_workspace_state"],
  deploymentTables: [
    "developer_agentic_os_vercel_project_mapping",
    "developer_agentic_os_vercel_project_history",
    "developer_agentic_os_github_repository_registration",
  ],
  tenantKey: "tenant_id",
  tenantScopedDomains: [
    "hosted-state",
    "workspace-state",
    "identity",
    "repositories",
    "deployments",
    "webhook-events",
    "webhook-projections",
    "failure-signals",
    "audit-records",
    "protected-secret-references",
  ],
  compatibility: "normalized-migration-tables-are-legacy-input-only",
} as const;

export type HostedPersistenceContract = typeof hostedPersistenceContract;

export function assertCanonicalHostedPersistenceContract(
  contract: HostedPersistenceContract = hostedPersistenceContract
): void {
  if (contract.tenantKey !== "tenant_id")
    throw new Error("Hosted persistence must be scoped by tenant_id.");
  if (contract.version < 1) throw new Error("Hosted persistence contract version is invalid.");
}
