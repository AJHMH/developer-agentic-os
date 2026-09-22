# Migration Recovery Runbook

## Prerequisites
- The migration correlation ID.
- Access required: Hosted Workspace Owner or system Admin.

## Least-Privilege Access
- Resuming migrations is done via `POST /api/hosted/domain/legacy-migration`.

## Execution
### Request
```http
POST /api/hosted/domain/legacy-migration?action=execute-legacy-migration HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
Content-Type: application/json

{
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
  "correlationId": "corr_abc"
}
```

## Verification
- Fetch the workspace state and verify the records exist. The `legacyMemoryMigrated` marker should now be present in the workspace domain state.

## Audit Checks
- Check the `hosted_workspace_audit` logs for events tied to the `correlationId`.

## Rollback
- Migration imports cannot be rolled back easily once completed. If necessary, delete the target workspace and start fresh, or issue delete mutations for imported entities.
