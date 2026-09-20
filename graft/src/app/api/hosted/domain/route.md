# src/app/api/hosted/domain/route.ts

- HostedDomainBody · type · L31-L59 — type HostedDomainBody = { action?: unknown; workspaceId?: unknown; connectorId?: unknown; credentialId?: unknown; repositoryId?: unknown; capability?: unknown; skillId?: unknown; allowedPaths?: unknown; localPath?: unknown; data?: unknown; package?: unknown; selectedKinds?: unknown; selectedRepositoryIds?: unknown; description?: unknown; title?: unknown; notes?: unknown; priority?: unknown; dueAt?: unknown; provider?: unknown; scopes?: unknown; secret?: unknown; expiresAt?: unknown; identity?: unknown; grantId?: unknown; requestedPath?: unknown; approval?: unknown; providerAction?: unknown; };
- GET · function · L61-L123 — async function GET(request: Request)
- POST · function · L125-L361 — async function POST(request: Request)
- isRecord · function · L363-L365 — function isRecord(value: unknown): value is Record<string, unknown>
- isStringArray · function · L366-L372 — function isStringArray(value: unknown, allowEmpty = false): value is string[]
- requiredString · function · L373-L375 — function requiredString(body: HostedDomainBody, key: keyof HostedDomainBody): boolean
- validateBody · function · L376-L567 — function validateBody(body: HostedDomainBody): string | null
- isMigrationPackage · function · L568-L598 — function isMigrationPackage(value: unknown): boolean
