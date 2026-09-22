import { HostedDomainError } from "../hosted-domain/hosted-domain-store";

export function isHostedInternalOwnerEnabled(): boolean {
  const envFlag =
    process.env.DEV_AGENTIC_OS_FEATURE_HOSTED_INTERNAL_OWNER ??
    process.env.FEATURE_HOSTED_INTERNAL_OWNER;

  if (envFlag !== undefined) {
    return envFlag.trim().toLowerCase() === "true" || envFlag.trim() === "1";
  }

  // The internal owner cohort is fully verified and promoted to production by default.
  return true;
}

export function assertHostedInternalOwnerEnabled(): void {
  if (!isHostedInternalOwnerEnabled()) {
    throw new HostedDomainError(
      "FEATURE_DISABLED",
      "The hosted internal owner production feature is not enabled for this deployment."
    );
  }
}

export function isHostedCollaboratorRolloutEnabled(): boolean {
  const envFlag =
    process.env.DEV_AGENTIC_OS_FEATURE_HOSTED_COLLABORATORS ??
    process.env.FEATURE_HOSTED_COLLABORATORS;

  if (envFlag !== undefined) {
    return envFlag.trim().toLowerCase() === "true" || envFlag.trim() === "1";
  }

  if (process.env.NODE_ENV === "test") {
    return true;
  }

  // Collaborators remain disabled until the operator UI is complete.
  return false;
}
