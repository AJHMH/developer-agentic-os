import type { HostedIdentity } from "@/types/hosted-workspace";
import { auth } from "@clerk/nextjs/server";

export class AuthError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED",
    message = "Authentication is required."
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthAdapter {
  authenticate(request: Request): Promise<HostedIdentity>;
}

export interface HostedTokenVerifier {
  verify(token: string): Promise<HostedIdentity | null>;
}

export class UnconfiguredHostedTokenVerifier implements HostedTokenVerifier {
  async verify(token: string): Promise<HostedIdentity | null> {
    void token;
    throw new AuthError(
      "UNAUTHENTICATED",
      "No hosted token verifier is configured for this deployment."
    );
  }
}

export class TokenAuthAdapter implements AuthAdapter {
  constructor(private readonly verifier: HostedTokenVerifier) {}

  async authenticate(request: Request): Promise<HostedIdentity> {
    const authorization = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
    if (!authorization) throw new AuthError("UNAUTHENTICATED");
    const identity = await this.verifier.verify(authorization[1]);
    if (!identity) throw new AuthError("UNAUTHENTICATED");
    return identity;
  }
}

export class DeterministicAuthAdapter implements AuthAdapter {
  constructor(
    private readonly fixtureMode = (process.env.NODE_ENV === "test" ||
      process.env.NODE_ENV === "development") &&
      process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
  ) {}

  async authenticate(request: Request): Promise<HostedIdentity> {
    if (!this.fixtureMode)
      throw new AuthError("UNAUTHENTICATED", "A configured hosted token is required.");
    const userId = request.headers.get("x-hosted-user-id")?.trim();
    if (!userId) throw new AuthError("UNAUTHENTICATED");
    const tenantId = request.headers.get("x-hosted-tenant-id")?.trim() || `personal:${userId}`;
    const displayName = request.headers.get("x-hosted-user-name")?.trim() || userId;
    const orgRole = request.headers.get("x-hosted-org-role")?.trim();
    return {
      userId,
      tenantId,
      displayName,
      ...(orgRole === "org:admin" || orgRole === "org:member" ? { orgRole } : {}),
    };
  }
}

export class ClerkAuthAdapter implements AuthAdapter {
  async authenticate(request: Request): Promise<HostedIdentity> {
    void request;
    const identity = await auth();
    if (!identity.userId) throw new AuthError("UNAUTHENTICATED");
    if (!identity.orgId)
      throw new AuthError(
        "UNAUTHENTICATED",
        "Select an organization before opening the hosted application."
      );
    return {
      userId: identity.userId,
      tenantId: identity.orgId,
      displayName: identity.userId,
      ...(identity.orgRole === "org:admin" || identity.orgRole === "org:member"
        ? { orgRole: identity.orgRole }
        : {}),
    };
  }
}

const tokenAuthAdapter = new TokenAuthAdapter(new UnconfiguredHostedTokenVerifier());
const clerkAuthAdapter = new ClerkAuthAdapter();

export const authAdapter: AuthAdapter = {
  authenticate(request) {
    return (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") &&
      process.env.HOSTED_AUTH_FIXTURE_MODE === "true"
      ? new DeterministicAuthAdapter(true).authenticate(request)
      : process.env.CLERK_SECRET_KEY
        ? clerkAuthAdapter.authenticate(request)
        : tokenAuthAdapter.authenticate(request);
  },
};
