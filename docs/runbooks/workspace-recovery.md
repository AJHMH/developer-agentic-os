# Hosted Workspace Recovery & Destructive Operations Runbook

## Overview

In Developer Agentic OS hosted environments, workspace destruction (soft-deletion / tombstoning) is a protected, auditable operation requiring explicit Owner authority or Admin delegation via one-time cryptographically correlated Owner Approvals.

When a workspace is soft-deleted, it enters a `tombstoned` state. Standard operational APIs and user listings immediately fail closed (`404 Not Found`), preventing accidental mutations. Simultaneously, an automatic recovery snapshot is sealed, returning immutable verification metadata to the caller.

---

## 1. Destructive Workspace Deletion

### Authorization Requirements

- **Owner**: May delete the workspace directly (`DELETE /api/hosted/workspaces/:id`).
- **Admin**: Cannot delete without an active, unconsumed Owner Approval binding:
  - `action`: `"workspace.delete"`
  - `target`: The specific workspace UUID
  - `version`: The resource version or timestamp
  - `reason`: Mandatory operational justification
  - `actorId`: The executing admin's user ID
- **Member**: Hard-rejected (`403 Forbidden`).

### Operational Request Example (Admin with Owner Approval)

```http
DELETE /api/hosted/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6 HTTP/1.1
Host: api.developer-agentic-os.com
Authorization: Bearer <clerk_or_jwt_token>
X-API-Version: 2026-09-01
X-Approval-ID: 7b8c9d0e-1f2a-4b3c-9d8e-0f1a2b3c4d5e
Content-Type: application/json

{
  "approvalId": "7b8c9d0e-1f2a-4b3c-9d8e-0f1a2b3c4d5e",
  "version": "active"
}
```

### Response Payload & Verification Seam

The response provides structured recovery metadata:

```json
{
  "ok": true,
  "workspaceId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "status": "tombstoned",
  "recovery": {
    "recoveryBackupId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "backupChecksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "deletedAt": "2026-09-21T13:30:00.000Z",
    "deletedBy": "user_admin_123",
    "retentionWindowDays": 30,
    "runbook": "docs/runbooks/workspace-recovery.md",
    "restoreSeam": "/api/hosted/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6/recovery"
  }
}
```

---

## 2. Inspecting Recovery Metadata

Engineers and automated runbooks can verify tombstoned state and recovery checksums:

```http
GET /api/hosted/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6/recovery HTTP/1.1
Authorization: Bearer <token>
X-API-Version: 2026-09-01
```

Response:

```json
{
  "recovery": {
    "recoveryBackupId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "backupChecksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "deletedAt": "2026-09-21T13:30:00.000Z",
    "deletedBy": "user_admin_123",
    "retentionWindowDays": 30,
    "runbook": "docs/runbooks/workspace-recovery.md",
    "restoreSeam": "/api/hosted/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6/recovery"
  }
}
```

---

## 3. Restoration Procedure

To restore a tombstoned workspace within its 30-day retention window:

### Via API Route

```http
POST /api/hosted/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6/recovery HTTP/1.1
Authorization: Bearer <token>
X-API-Version: 2026-09-01
Content-Type: application/json

{}
```

### Behavior

- Restores workspace `status` to `"active"`.
- Clears `deletedAt` and recovery references.
- Emits audit event `workspace.restored` with caller and correlation ID.
- Restores workspace to user workspace navigation and domain query access.

---

## 4. Emergency Break-Glass & Audit Trail

All actions (approval grant, revocation, consumption, ownership transfer, deletion, and restoration) are logged in `hosted_workspace_audit` with:

- `action`: E.g. `"approval.created"`, `"approval.consumed"`, `"workspace.deleted"`, `"workspace.restored"`
- `user_id`: Authenticated actor
- `workspace_id`: Target workspace
- `correlation_id`: Runbook tracing identifier
- `occurred_at`: ISO 8601 timestamp

Audits are immutable and permanently retained.
