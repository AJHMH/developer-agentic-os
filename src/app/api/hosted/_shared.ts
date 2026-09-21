import { NextResponse } from "next/server";

import { AuthError, authAdapter } from "@/server/hosted-auth/auth-adapter";
import { hostedDomainStoreForTenant } from "@/server/hosted-domain/hosted-domain-store";
import { hostedWorkspaceStoreForTenant } from "@/server/hosted-workspaces/hosted-workspace-store";
import {
  applyStandardHeaders,
  createHostedErrorResponse,
  DEFAULT_API_VERSION,
  extractIdempotencyKey,
  HEADER_API_VERSION,
  parseApiVersion,
  resolveCorrelationId,
  type HostedErrorCode,
} from "@/server/hosted-api/contract";
import {
  currentApiVersion,
  currentCorrelationId,
  runWithHostedContext,
} from "@/server/hosted-api/context";
import { evaluateIdempotency, HostedIdempotencyStore } from "@/server/hosted-api/idempotency";

export const migrationIncompleteResponse = {
  error: "Hosted Tenant migration is incomplete. Run the hosted Neon migrations and retry.",
};
export const persistenceUnconfiguredResponse = {
  error: "Hosted persistence is not configured. Set the hosted database URL and retry.",
};
export const persistenceUnavailableResponse = {
  error:
    "Hosted persistence is temporarily unavailable. Retry once the hosted database is reachable.",
};

export type HostedRouteContext = {
  identity: Awaited<ReturnType<typeof authAdapter.authenticate>>;
  workspaceStore: ReturnType<typeof hostedWorkspaceStoreForTenant>;
  domainStore: ReturnType<typeof hostedDomainStoreForTenant>;
  correlationId: string;
  version: string;
  isVersioned: boolean;
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

export function formatHostedError(
  error: unknown,
  correlationId: string,
  version: string = DEFAULT_API_VERSION,
  isVersioned: boolean = true
): NextResponse {
  if (!isVersioned) {
    let legacyResponse: NextResponse;
    if (error instanceof AuthError) {
      legacyResponse = NextResponse.json({ error: error.message }, { status: 401 });
    } else {
      legacyResponse = hostedError(error);
    }
    return applyStandardHeaders(legacyResponse, correlationId, version);
  }

  if (error instanceof AuthError) {
    return createHostedErrorResponse({
      code: "UNAUTHENTICATED",
      message: error.message,
      status: 401,
      retryable: false,
      correlationId,
      version,
    });
  }

  if (error instanceof Error && error.name === "HostedDomainError") {
    const code = (error as unknown as { code: string }).code;
    const mapping: Record<string, { status: number; code: HostedErrorCode; retryable: boolean }> = {
      FORBIDDEN: { status: 403, code: "FORBIDDEN", retryable: false },
      FEATURE_DISABLED: { status: 403, code: "FEATURE_DISABLED", retryable: false },
      NOT_FOUND: { status: 404, code: "NOT_FOUND", retryable: false },
      INVALID: { status: 400, code: "VALIDATION_ERROR", retryable: false },
      STALE: { status: 409, code: "STALE_STATE", retryable: true },
      CONFLICT: { status: 409, code: "CONFLICT", retryable: false },
    };
    const mapped = mapping[code] ?? { status: 400, code: "VALIDATION_ERROR", retryable: false };
    return createHostedErrorResponse({
      code: mapped.code,
      message: error.message,
      status: mapped.status,
      retryable: mapped.retryable,
      correlationId,
      version,
    });
  }

  if (error instanceof Error && error.name === "HostedWorkspaceError") {
    const code = (error as unknown as { code: "INVALID_NAME" | "NOT_FOUND" }).code;
    return createHostedErrorResponse({
      code: code === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR",
      message: error.message,
      status: code === "NOT_FOUND" ? 404 : 400,
      retryable: false,
      correlationId,
      version,
    });
  }

  const messages = errorMessages(error);
  if (messages.some((message) => /^Canonical .+ schema is not installed\.$/.test(message))) {
    return createHostedErrorResponse({
      code: "MIGRATION_INCOMPLETE",
      message: migrationIncompleteResponse.error,
      status: 409,
      retryable: false,
      correlationId,
      version,
    });
  }

  if (messages.some((message) => /^Hosted persistence requires\b/i.test(message))) {
    return createHostedErrorResponse({
      code: "PERSISTENCE_UNCONFIGURED",
      message: persistenceUnconfiguredResponse.error,
      status: 503,
      retryable: false,
      correlationId,
      version,
    });
  }

  if (
    messages.some(
      (message) =>
        /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed)\b/i.test(message) ||
        /connection terminated unexpectedly/i.test(message) ||
        /could not connect/i.test(message)
    )
  ) {
    return createHostedErrorResponse({
      code: "PERSISTENCE_UNAVAILABLE",
      message: persistenceUnavailableResponse.error,
      status: 503,
      retryable: true,
      correlationId,
      version,
    });
  }

  console.error(error);
  return createHostedErrorResponse({
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    status: 500,
    retryable: false,
    correlationId,
    version,
  });
}

export function hostedError(error: unknown): NextResponse {
  const correlationId = currentCorrelationId();
  if (correlationId) {
    return formatHostedError(error, correlationId, currentApiVersion() ?? DEFAULT_API_VERSION);
  }

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

export async function executeHostedRoute(
  request: Request,
  handler: (context: HostedRouteContext) => Promise<NextResponse | Response>
): Promise<NextResponse | Response> {
  const correlationId = resolveCorrelationId(request);
  const versionCheck = parseApiVersion(request, correlationId);
  if ("errorResponse" in versionCheck) {
    return versionCheck.errorResponse;
  }
  const version = versionCheck.version;
  const isVersioned = Boolean(
    request.headers.get(HEADER_API_VERSION)?.trim() ||
    new URL(request.url).searchParams.get("api-version")?.trim()
  );

  return runWithHostedContext({ correlationId, apiVersion: version }, async () => {
    try {
      const identity = await authAdapter.authenticate(request);
      const workspaceStore = hostedWorkspaceStoreForTenant(identity.tenantId);
      await workspaceStore.recordIdentity(identity);
      const domainStore = hostedDomainStoreForTenant(identity.tenantId);

      const idempotencyKey = extractIdempotencyKey(request);
      let idempotencySave:
        | ((status: number, body: unknown, headers?: Record<string, string>) => Promise<void>)
        | null = null;

      if (idempotencyKey && request.method !== "GET" && request.method !== "HEAD") {
        const rawBody = await request
          .clone()
          .text()
          .catch(() => "");
        const idempotencyResult = await evaluateIdempotency(
          HostedIdempotencyStore.getInstance(),
          identity.tenantId,
          idempotencyKey,
          rawBody,
          correlationId,
          version
        );

        if (idempotencyResult.type === "replay") {
          return idempotencyResult.response;
        }
        if (idempotencyResult.type === "mismatch") {
          return idempotencyResult.errorResponse;
        }
        idempotencySave = idempotencyResult.save;
      }

      const routeContext: HostedRouteContext = {
        identity,
        workspaceStore,
        domainStore,
        correlationId,
        version,
        isVersioned,
      };

      const response = await handler(routeContext);
      const nextResponse =
        response instanceof NextResponse
          ? response
          : new NextResponse(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });

      applyStandardHeaders(nextResponse, correlationId, version);

      if (idempotencySave && nextResponse.status >= 200 && nextResponse.status < 300) {
        try {
          const responseBody = await nextResponse.clone().json();
          await idempotencySave(nextResponse.status, responseBody);
        } catch {
          // Non-JSON response, ignore caching
        }
      }

      return nextResponse;
    } catch (error) {
      return formatHostedError(error, correlationId, version, isVersioned);
    }
  });
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
