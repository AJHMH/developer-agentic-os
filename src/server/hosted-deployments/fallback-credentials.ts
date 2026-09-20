import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  type ProtectedSecretStore,
  DeterministicProtectedSecretStore,
} from "../hosted-domain/hosted-domain-store";
import { EncryptedProtectedSecretStore } from "../hosted-persistence/neon-hosted-provider";

export type DeploymentFallbackCredential = {
  id: string;
  tenantId: string;
  owner: string;
  repository: string;
  secretReference: string;
  status: "active" | "rotated" | "revoked";
  removalDeadline: string; // ISO timestamp
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  description?: string;
};

export type PublicDeploymentFallbackCredential = {
  id: string;
  tenantId: string;
  owner: string;
  repository: string;
  status: "active" | "rotated" | "revoked" | "retired";
  removalDeadline: string;
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  description?: string;
  isRetired: boolean;
  isExpired: boolean;
};

export type CreateFallbackCredentialInput = {
  tenantId: string;
  owner: string;
  repository: string;
  rawSecret?: string;
  removalDeadline: string;
  description?: string;
};

export type FallbackVerificationResult =
  | {
      valid: true;
      credential: DeploymentFallbackCredential;
    }
  | {
      valid: false;
      code: "INVALID_SECRET" | "EXPIRED" | "REVOKED" | "SCOPE_MISMATCH" | "NOT_FOUND";
      reason: string;
      credentialId?: string;
      credential?: DeploymentFallbackCredential;
    };

export function isRemovalDeadlinePassed(removalDeadline: string, now: Date = new Date()): boolean {
  const deadlineTime = new Date(removalDeadline).getTime();
  if (Number.isNaN(deadlineTime)) return true;
  return now.getTime() >= deadlineTime;
}

export function toPublicFallbackCredential(
  credential: DeploymentFallbackCredential,
  now: Date = new Date()
): PublicDeploymentFallbackCredential {
  const expired = isRemovalDeadlinePassed(credential.removalDeadline, now);
  const isRetired = expired || credential.status === "revoked";
  return {
    id: credential.id,
    tenantId: credential.tenantId,
    owner: credential.owner,
    repository: credential.repository,
    status: isRetired ? "retired" : credential.status,
    removalDeadline: credential.removalDeadline,
    createdAt: credential.createdAt,
    ...(credential.rotatedAt ? { rotatedAt: credential.rotatedAt } : {}),
    ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
    ...(credential.description ? { description: credential.description } : {}),
    isRetired,
    isExpired: expired,
  };
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifySecretAgainstReference(
  secret: string,
  reference: string,
  secretStore?: ProtectedSecretStore
): boolean {
  if (!secret || !reference) return false;
  if (reference.startsWith("fixture-secret://")) {
    const expectedHash = reference.replace("fixture-secret://", "");
    const actualHash = createHash("sha256").update(secret).digest("hex");
    return safeCompare(expectedHash, actualHash);
  }
  if (reference.startsWith("encrypted-secret:v1:")) {
    try {
      let decrypted: string;
      if (
        secretStore &&
        "decrypt" in secretStore &&
        typeof (secretStore as unknown as { decrypt: (ref: string) => string }).decrypt ===
          "function"
      ) {
        decrypted = (secretStore as unknown as { decrypt: (ref: string) => string }).decrypt(
          reference
        );
      } else {
        const store = new EncryptedProtectedSecretStore();
        decrypted = store.decrypt(reference);
      }
      return safeCompare(decrypted, secret);
    } catch {
      return false;
    }
  }
  return false;
}

export class DeploymentFallbackCredentialManager {
  private readonly credentials = new Map<string, DeploymentFallbackCredential>();

  constructor(
    private readonly secretStore: ProtectedSecretStore = process.env.DEV_AGENTIC_OS_SECRET_KEY
      ? new EncryptedProtectedSecretStore()
      : new DeterministicProtectedSecretStore()
  ) {}

  async create(
    input: CreateFallbackCredentialInput,
    now: Date = new Date()
  ): Promise<{ credential: PublicDeploymentFallbackCredential; rawSecret: string }> {
    if (!input.tenantId?.trim()) throw new Error("tenantId is required.");
    if (!input.owner?.trim()) throw new Error("owner is required.");
    if (!input.repository?.trim()) throw new Error("repository is required.");

    const deadline = new Date(input.removalDeadline);
    if (Number.isNaN(deadline.getTime())) {
      throw new Error("removalDeadline must be a valid ISO timestamp.");
    }
    if (deadline.getTime() <= now.getTime()) {
      throw new Error("removalDeadline must be in the future.");
    }

    const rawSecret =
      input.rawSecret?.trim() || `dep_fallback_${randomBytes(24).toString("base64url")}`;
    const secretReference = await this.secretStore.put(rawSecret);

    const credential: DeploymentFallbackCredential = {
      id: randomUUID(),
      tenantId: input.tenantId.trim(),
      owner: input.owner.trim(),
      repository: input.repository.trim(),
      secretReference,
      status: "active",
      removalDeadline: deadline.toISOString(),
      createdAt: now.toISOString(),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    };

    this.credentials.set(credential.id, credential);
    return {
      credential: toPublicFallbackCredential(credential, now),
      rawSecret,
    };
  }

  async rotate(
    id: string,
    newRawSecret?: string,
    newRemovalDeadline?: string,
    now: Date = new Date()
  ): Promise<{ credential: PublicDeploymentFallbackCredential; rawSecret: string }> {
    const existing = this.credentials.get(id);
    if (!existing) throw new Error("Fallback credential not found.");
    if (existing.status === "revoked") throw new Error("Cannot rotate a revoked credential.");

    let removalDeadline = existing.removalDeadline;
    if (newRemovalDeadline) {
      const parsedDeadline = new Date(newRemovalDeadline);
      if (Number.isNaN(parsedDeadline.getTime()) || parsedDeadline.getTime() <= now.getTime()) {
        throw new Error("newRemovalDeadline must be a valid future ISO timestamp.");
      }
      removalDeadline = parsedDeadline.toISOString();
    }

    const rawSecret =
      newRawSecret?.trim() || `dep_fallback_${randomBytes(24).toString("base64url")}`;
    const secretReference = await this.secretStore.put(rawSecret);

    existing.secretReference = secretReference;
    existing.status = "active";
    existing.removalDeadline = removalDeadline;
    existing.rotatedAt = now.toISOString();

    return {
      credential: toPublicFallbackCredential(existing, now),
      rawSecret,
    };
  }

  revoke(id: string, now: Date = new Date()): PublicDeploymentFallbackCredential {
    const existing = this.credentials.get(id);
    if (!existing) throw new Error("Fallback credential not found.");
    existing.status = "revoked";
    existing.revokedAt = now.toISOString();
    return toPublicFallbackCredential(existing, now);
  }

  list(tenantId?: string, now: Date = new Date()): PublicDeploymentFallbackCredential[] {
    const all = Array.from(this.credentials.values());
    const filtered = tenantId ? all.filter((c) => c.tenantId === tenantId) : all;
    return filtered.map((c) => toPublicFallbackCredential(c, now));
  }

  get(id: string, now: Date = new Date()): PublicDeploymentFallbackCredential | null {
    const existing = this.credentials.get(id);
    return existing ? toPublicFallbackCredential(existing, now) : null;
  }

  verify(
    token: string,
    expectedScope: { tenantId?: string; owner?: string; repository?: string },
    now: Date = new Date()
  ): FallbackVerificationResult {
    if (!token?.trim()) {
      return { valid: false, code: "INVALID_SECRET", reason: "Token is required." };
    }

    // Find matching active or expired credential
    for (const credential of this.credentials.values()) {
      const matches = verifySecretAgainstReference(
        token.trim(),
        credential.secretReference,
        this.secretStore
      );
      if (!matches) continue;

      // Matched secret! Check revocation
      if (credential.status === "revoked") {
        return {
          valid: false,
          code: "REVOKED",
          reason: "Fallback credential has been revoked.",
          credentialId: credential.id,
          credential,
        };
      }

      // Check removal deadline
      if (isRemovalDeadlinePassed(credential.removalDeadline, now)) {
        return {
          valid: false,
          code: "EXPIRED",
          reason: `Fallback credential expired at removal deadline: ${credential.removalDeadline}.`,
          credentialId: credential.id,
          credential,
        };
      }

      // Check scope
      if (expectedScope.tenantId && expectedScope.tenantId !== credential.tenantId) {
        return {
          valid: false,
          code: "SCOPE_MISMATCH",
          reason: "Fallback credential is not scoped to this Tenant.",
          credentialId: credential.id,
          credential,
        };
      }

      if (
        expectedScope.owner &&
        expectedScope.owner.toLowerCase() !== credential.owner.toLowerCase()
      ) {
        return {
          valid: false,
          code: "SCOPE_MISMATCH",
          reason: "Fallback credential repository owner does not match.",
          credentialId: credential.id,
          credential,
        };
      }

      if (
        expectedScope.repository &&
        expectedScope.repository.toLowerCase() !== credential.repository.toLowerCase()
      ) {
        return {
          valid: false,
          code: "SCOPE_MISMATCH",
          reason: "Fallback credential repository name does not match.",
          credentialId: credential.id,
          credential,
        };
      }

      return { valid: true, credential };
    }

    return {
      valid: false,
      code: "NOT_FOUND",
      reason: "Fallback credential was not found or invalid.",
    };
  }

  clear(): void {
    this.credentials.clear();
  }
}

// Global shared singleton for fallback credentials
export const fallbackCredentialManager = new DeploymentFallbackCredentialManager();
