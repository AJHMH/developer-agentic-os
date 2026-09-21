import { HostedDomainError } from "../hosted-domain/hosted-domain-store";

export function isHostedInternalOwnerEnabled(): boolean {
  const envFlag =
    process.env.DEV_AGENTIC_OS_FEATURE_HOSTED_INTERNAL_OWNER ??
    process.env.FEATURE_HOSTED_INTERNAL_OWNER;

  if (envFlag !== undefined) {
    return envFlag.trim().toLowerCase() === "true" || envFlag.trim() === "1";
  }

  // In production mode, feature flags fail closed by default.
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  // In test and dev modes, default to enabled unless explicitly disabled.
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
