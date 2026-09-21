# src/app/api/hosted/domain/route.ts

- HostedDomainBody · type · L33-L74 — type HostedDomainBody = { action?: unknown; workspaceId?: unknown; connectorId?: unknown; credentialId?: unknown; repositoryId?: unknown; capability?: unknown; skillId?: unknown; allowedPaths?: unknown; localPath?: unknown; data?: unknown; package?: unknown; selectedKinds?: unknown; selectedRepositoryIds?: unknown; description?: unknown; title?: unknown; notes?: unknown; priority?: unknown; dueAt?: unknown; conflictId?: unknown; decision?: unknown; expectedVersion?: unknown; provider?: unknown; scopes?: unknown; secret?: unknown; expiresAt?: unknown; identity?: unknown; grantId?: unknown; requestedPath?: unknown; approval?: unknown; approvalId?: unknown; version?: unknown; providerAction?: unknown; isOffline?: unknown; records?: unknown; kind?: unknown; recordId?: unknown; updates?: unknown; baseVersion?: unknown; source?: unknown; clientTimestamp?: unknown; };
- GET · function · L76-L158 — async function GET(request: Request)
- POST · function · L160-L472 — async function POST(request: Request)
- isRecord · function · L474-L476 — function isRecord(value: unknown): value is Record<string, unknown>
- isStringArray · function · L477-L483 — function isStringArray(value: unknown, allowEmpty = false): value is string[]
- requiredString · function · L484-L486 — function requiredString(body: HostedDomainBody, key: keyof HostedDomainBody): boolean
- validateBody · function · L487-L710 — function validateBody(body: HostedDomainBody): string | null
- isMigrationPackage · function · L711-L741 — function isMigrationPackage(value: unknown): boolean
