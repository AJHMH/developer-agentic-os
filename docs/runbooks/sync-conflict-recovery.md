# Sync Conflict Recovery Runbook

## Prerequisites
- Knowledge of the conflict ID.
- Target workspace must be active.
- Access required: Hosted Workspace Owner or system Admin with `sync.conflict.resolve` approval.

## Least-Privilege Access
- Resolving conflicts requires `POST /api/hosted/workspaces/:workspaceId/conflicts/:conflictId/resolve`.

## Execution
### Request
```http
POST /api/hosted/workspaces/ws_123/conflicts/conf_789/resolve HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
Content-Type: application/json

{
  "resolution": "force_hosted",
  "expectedVersion": 2
}
```

### Expected Response
```json
{
  "ok": true,
  "status": "resolved",
  "resolution": {
    "action": "force_hosted",
    "resolvedAt": "2026-09-21T14:00:00Z"
  }
}
```

## Verification
- Fetch conflicts using `GET /api/hosted/workspaces/ws_123/conflicts`. The resolved conflict should no longer appear.

## Audit Checks
- Check the `hosted_workspace_audit` logs for an event with `action: "sync.conflict.resolved"`.

## Rollback
- Conflict resolution is applied to the domain store and cannot be automatically rolled back. If the wrong resolution was chosen, a compensating manual domain mutation is required.
