import { NextResponse } from "next/server";

import { AuthError, authAdapter } from "@/server/hosted-auth/auth-adapter";
import { hostedDomainStoreForTenant } from "@/server/hosted-domain/hosted-domain-store";
import { hostedWorkspaceStoreForTenant } from "@/server/hosted-workspaces/hosted-workspace-store";

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
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}
