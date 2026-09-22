# Migration Recovery Runbook

## Prerequisites

- The migration correlation ID.
- Access required: Hosted Workspace Owner or system Admin.

## Least-Privilege Access

- Resuming migrations is done via `POST /api/hosted/domain/legacy-migration`.

## Execution

### Request

```http
POST /api/hosted/domain/legacy-migration HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
Content-Type: application/json

{
  "action": "execute-legacy-migration",
  "workspaceId": "ws_123",
  "repositoryId": "repo_456",
  "resumeFrom": "corr_abc"
}
```

### Expected Response

```json
{
  "status": "completed",
  "imported": 15,
  "quarantined": [],
  "warnings": [],
  "correlationId": "<server-generated-uuid>"
}
```

## Verification

- Fetch the workspace records and verify a `legacyMigrations` entry containing the returned `correlationId` is present.

## Audit Checks

- Check the `hosted_workspace_audit` logs for the `legacyMigrations` marker creation event.

## Rollback

- Migration imports cannot be rolled back easily once completed. If necessary, delete the target workspace and start fresh, or issue delete mutations for imported entities.
