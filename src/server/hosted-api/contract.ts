import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export const SUPPORTED_API_VERSIONS = ["2026-09-01", "v1"] as const;
export type SupportedApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];
export const DEFAULT_API_VERSION: SupportedApiVersion = "2026-09-01";

export const HEADER_API_VERSION = "x-api-version";
export const HEADER_CORRELATION_ID = "x-correlation-id";
export const HEADER_IDEMPOTENCY_KEY = "idempotency-key";
export const HEADER_IDEMPOTENT_REPLAYED = "x-idempotent-replayed";

export type HostedErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_API_VERSION"
  | "NOT_FOUND"
  | "STALE_STATE"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_MISMATCH"
  | "PROVIDER_ERROR"
  | "PERSISTENCE_UNAVAILABLE"
  | "PERSISTENCE_UNCONFIGURED"
  | "MIGRATION_INCOMPLETE"
  | "FEATURE_DISABLED"
  | "INTERNAL_ERROR";

export type HostedErrorEnvelope = {
  error: {
    code: HostedErrorCode;
    message: string;
    retryable: boolean;
    correlationId: string;
    details?: Record<string, unknown>;
  };
  code: HostedErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
};

export type ErrorResponseOptions = {
  code: HostedErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  correlationId: string;
  version?: string;
  details?: Record<string, unknown>;
};

export function resolveCorrelationId(request: Request): string {
  const headerValue = request.headers.get(HEADER_CORRELATION_ID)?.trim();
  if (headerValue && headerValue.length > 0) {
    return headerValue;
  }
  return randomUUID();
}

export function extractIdempotencyKey(request: Request): string | null {
  const headerValue = request.headers.get(HEADER_IDEMPOTENCY_KEY)?.trim();
  return headerValue && headerValue.length > 0 ? headerValue : null;
}

export function parseApiVersion(
  request: Request,
  correlationId: string
): { version: string } | { errorResponse: NextResponse } {
  let requestedVersion = request.headers.get(HEADER_API_VERSION)?.trim();
  if (!requestedVersion) {
    try {
      const url = new URL(request.url);
      requestedVersion = url.searchParams.get("api-version")?.trim();
    } catch {
      // Ignored
    }
  }

  if (!requestedVersion) {
    return { version: DEFAULT_API_VERSION };
  }

  if (SUPPORTED_API_VERSIONS.includes(requestedVersion as SupportedApiVersion)) {
    return { version: requestedVersion };
  }

  return {
    errorResponse: createHostedErrorResponse({
      code: "UNSUPPORTED_API_VERSION",
      message: `Unsupported API version '${requestedVersion}'. Supported versions: ${SUPPORTED_API_VERSIONS.join(", ")}.`,
      status: 400,
      retryable: false,
      correlationId,
      version: DEFAULT_API_VERSION,
    }),
  };
}

export function createHostedErrorResponse(options: ErrorResponseOptions): NextResponse {
  const { code, message, status, retryable, correlationId, version, details } = options;

  const envelope: HostedErrorEnvelope = {
    error: {
      code,
      message,
      retryable,
      correlationId,
      ...(details ? { details } : {}),
    },
    code,
    message,
    retryable,
    correlationId,
    ...(details ? { details } : {}),
  };

  const headers: Record<string, string> = {
    [HEADER_API_VERSION]: version ?? DEFAULT_API_VERSION,
    [HEADER_CORRELATION_ID]: correlationId,
    "content-type": "application/json",
  };

  return new NextResponse(JSON.stringify(envelope), {
    status,
    headers,
  });
}

export function applyStandardHeaders(
  response: NextResponse,
  correlationId: string,
  version: string = DEFAULT_API_VERSION
): NextResponse {
  if (!response.headers.has(HEADER_API_VERSION)) {
    response.headers.set(HEADER_API_VERSION, version);
  }
  if (!response.headers.has(HEADER_CORRELATION_ID)) {
    response.headers.set(HEADER_CORRELATION_ID, correlationId);
  }
  return response;
}
