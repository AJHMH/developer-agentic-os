# Sync Conflict Recovery Runbook

## Prerequisites

- Knowledge of the conflict ID.
- Target workspace must be active.
- Access required: Hosted Workspace Owner or system Admin.

## Least-Privilege Access

- Resolving conflicts requires `POST /api/hosted/domain`.

## Execution

### Request

```http
POST /api/hosted/domain HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
Content-Type: application/json

{
  "action": "resolve-sync-conflict",
  "workspaceId": "ws_123",
  "conflictId": "conf_789",
  "decision": "use_hosted",
  "expectedVersion": 2
}
```

### Expected Response

```json
{
  "conflict": {
    "id": "conf_789",
    "status": "resolved",
    "resolution": {
      "decision": "use_hosted"
    }
  }
}
```

## Verification

- Fetch conflicts using `GET /api/hosted/domain?workspaceId=ws_123&view=sync-conflicts`. The resolved conflict should be present with `status: "resolved"` and the expected `resolution.decision`.

## Audit Checks

- Check the `hosted_workspace_audit` logs for an event with `action: "sync.conflict.resolved"`.

## Rollback

- Conflict resolution is applied to the domain store and cannot be automatically rolled back. If the wrong resolution was chosen, a compensating manual domain mutation is required.
