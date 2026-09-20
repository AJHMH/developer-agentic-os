# Hosted Operational API Contract

This document specifies the standardized operational API contract for Developer Agentic OS hosted operations. It provides a consistent, versioned interface designed for engineer-runbook clients, autonomous agents, and command-centre UI to safely authenticate, retry mutations idempotently, correlate actions across boundaries, and handle failures with structured, machine-readable envelopes.

---

## 1. API Versioning

Hosted operational endpoints declare a supported API version and reject unsupported versions predictably.

- **Supported Versions**: `2026-09-01` (canonical), `v1` (alias).
- **Default Version**: `2026-09-01` (applied when no version header is provided, preserving backward compatibility).
- **Request Header**: `X-API-Version` (case-insensitive).
- **Query Parameter Fallback**: `?api-version=2026-09-01`.
- **Response Header**: All responses include `X-API-Version: 2026-09-01`.

### Unsupported Version Rejection

Requests specifying an unsupported version are rejected with `400 Bad Request` and error code `UNSUPPORTED_API_VERSION`:

```json
{
  "error": {
    "code": "UNSUPPORTED_API_VERSION",
    "message": "Unsupported API version '1999-01-01'. Supported versions: 2026-09-01, v1.",
    "retryable": false,
    "correlationId": "4a788be4-7221-4ba2-8ef9-32cb53531b25"
  },
  "code": "UNSUPPORTED_API_VERSION",
  "message": "Unsupported API version '1999-01-01'. Supported versions: 2026-09-01, v1.",
  "retryable": false,
  "correlationId": "4a788be4-7221-4ba2-8ef9-32cb53531b25"
}
```

---

## 2. Idempotent Mutations

Mutation endpoints (`POST`, `PUT`, `DELETE`) accept an `Idempotency-Key` header to safely retry operations without duplicate side effects.

- **Header**: `Idempotency-Key: <unique-key>` (e.g. UUID or runbook step identifier).
- **Scoping**: Keys are strictly partitioned by Tenant (`tenantId:::key`).
- **Payload Verification**: Computes a SHA-256 hash of the normalized request body.

### Lifecycle & Behavior

1. **Initial Mutation**:
   - The mutation is executed once in domain storage.
   - The result (`status`, `headers`, and JSON body) is recorded under the tenant-scoped key.
   - Returned with standard headers.
2. **Identical Retry (Same Key, Same Payload)**:
   - Returns the exact cached response body and status code.
   - Does **not** re-execute the domain mutation or emit duplicate audit events (produces one logical effect).
   - Response header `X-Idempotent-Replayed: true` signals that the response was served from idempotency cache.
3. **Mismatched Payload Retry (Same Key, Different Payload)**:
   - Hard-rejected with `409 Conflict` and code `IDEMPOTENCY_KEY_MISMATCH`.
   - `retryable: false`.

---

## 3. Audit Correlation Tracking

Every request carries a correlation ID to trace actions and mutations across system boundaries.

- **Request Header**: `X-Correlation-ID: <id>` (optional). If omitted, the server generates a cryptographically secure UUID.
- **Response Header**: Returned in `X-Correlation-ID: <id>` on all responses (successes and errors).
- **Audit Evidence Propagation**:
  - The correlation ID is propagated via ambient request context (`AsyncLocalStorage`).
  - All audit events generated during the request in `HostedDomainStore` (`HostedAudit`) and `HostedWorkspaceStore` (`HostedAuditEvent`) record `correlationId`.
  - Clients can query `GET /api/hosted/audit` or `GET /api/hosted/domain?view=audit` to locate all evidence associated with a specific runbook operation.

---

## 4. Machine-Readable Error Envelope

All failure responses use a consistent machine-readable JSON structure, allowing programmatic error handling without parsing human-readable text.

### Envelope Schema

```typescript
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
```

### Error Code Taxonomy

| HTTP Status                 | Error Code                 | Description                                                    | Retryable |
| :-------------------------- | :------------------------- | :------------------------------------------------------------- | :-------: |
| `401 Unauthorized`          | `UNAUTHENTICATED`          | Missing or invalid authentication token                        |  `false`  |
| `403 Forbidden`             | `FORBIDDEN`                | Cross-tenant access or insufficient permissions                |  `false`  |
| `400 Bad Request`           | `VALIDATION_ERROR`         | Missing required fields, malformed JSON, or invalid parameters |  `false`  |
| `400 Bad Request`           | `UNSUPPORTED_API_VERSION`  | Requested version not in supported version list                |  `false`  |
| `404 Not Found`             | `NOT_FOUND`                | Workspace, repository, or record does not exist                |  `false`  |
| `409 Conflict`              | `STALE_STATE`              | Optimistic lock failure or stale resource version              |  `true`   |
| `409 Conflict`              | `CONFLICT`                 | Concurrent conflict or duplicate entity                        |  `false`  |
| `409 Conflict`              | `IDEMPOTENCY_KEY_MISMATCH` | Same idempotency key used with different request payload       |  `false`  |
| `409 Conflict`              | `MIGRATION_INCOMPLETE`     | Required database schema migrations not yet applied            |  `false`  |
| `502 Bad Gateway`           | `PROVIDER_ERROR`           | External provider (GitHub, Vercel) error                       |  `true`   |
| `503 Service Unavailable`   | `PERSISTENCE_UNAVAILABLE`  | Database connection refused or temporarily unreachable         |  `true`   |
| `503 Service Unavailable`   | `PERSISTENCE_UNCONFIGURED` | Database connection credentials not configured in environment  |  `false`  |
| `500 Internal Server Error` | `INTERNAL_ERROR`           | Unhandled internal runtime exception                           |  `false`  |

---

## 5. Proving Vertical Slices

The contract is implemented and verified at the HTTP route seam across existing hosted endpoints:

- `GET /api/hosted/workspaces` (Read slice)
- `POST /api/hosted/workspaces` (Mutation slice with idempotency and audit correlation)
- `GET /api/hosted/domain` (Read slice for domain views)
- `POST /api/hosted/domain` (Mutation slice for domain operations)
- `GET /api/hosted/audit` (Audit retrieval slice for correlation verification)
