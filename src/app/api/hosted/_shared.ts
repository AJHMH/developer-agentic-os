import { NextResponse } from "next/server";

import { AuthError, authAdapter } from "@/server/hosted-auth/auth-adapter";
import { hostedDomainStoreForTenant } from "@/server/hosted-domain/hosted-domain-store";
import { hostedWorkspaceStoreForTenant } from "@/server/hosted-workspaces/hosted-workspace-store";

const migrationIncompleteResponse = {
  error: "Hosted Tenant migration is incomplete. Run the hosted Neon migrations and retry.",
};
const persistenceUnconfiguredResponse = {
  error: "Hosted persistence is not configured. Set the hosted database URL and retry.",
};
const persistenceUnavailableResponse = {
  error:
    "Hosted persistence is temporarily unavailable. Retry once the hosted database is reachable.",
};

export async function hostedIdentity(request: Request) {
  try {
    const identity = await authAdapter.authenticate(request);
    const workspaceStore = hostedWorkspaceStoreForTenant(identity.tenantId);
    await workspaceStore.recordIdentity(identity);
    return {
      ...identity,
      workspaceStore,
      domainStore: hostedDomainStoreForTenant(identity.tenantId),
    };
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: 401 });
    return hostedError(error);
  }
}

export function hostedInfrastructureError(error: unknown): NextResponse | null {
  const messages = errorMessages(error);
  if (messages.some((message) => /^Canonical .+ schema is not installed\.$/.test(message)))
    return NextResponse.json(migrationIncompleteResponse, { status: 409 });
  if (messages.some((message) => /^Hosted persistence requires\b/i.test(message)))
    return NextResponse.json(persistenceUnconfiguredResponse, { status: 503 });
  if (
    messages.some(
      (message) =>
        /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed)\b/i.test(message) ||
        /connection terminated unexpectedly/i.test(message) ||
        /could not connect/i.test(message)
    )
  )
    return NextResponse.json(persistenceUnavailableResponse, { status: 503 });
  return null;
}

export function hostedError(error: unknown) {
  if (error instanceof Error && error.name === "HostedDomainError") {
    const statusByCode = { FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, STALE: 409 } as const;
    return NextResponse.json(
      { error: error.message },
      {
        status: statusByCode[(error as unknown as { code: keyof typeof statusByCode }).code] ?? 400,
      }
    );
  }
  if (error instanceof Error && error.name === "HostedWorkspaceError") {
    const code = (error as unknown as { code: "INVALID_NAME" | "NOT_FOUND" }).code;
    return NextResponse.json(
      { error: error.message },
      { status: code === "NOT_FOUND" ? 404 : 400 }
    );
  }
  const infrastructure = hostedInfrastructureError(error);
  if (infrastructure) return infrastructure;
  console.error(error);
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}
