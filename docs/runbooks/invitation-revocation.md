# Invitation Revocation Runbook

## Prerequisites

- Target workspace must be active or pending.
- Access required: Hosted Workspace Owner or system Admin.

## Least-Privilege Access

- Revocation must be performed using the `POST /api/hosted/invitations/:invitationId/revoke` endpoint to ensure proper audit logging.
- Do not manually delete records from the Postgres `hosted_workspace_invitations` table.

## Execution

### Request

```http
POST /api/hosted/invitations/inv_456/revoke HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
```

### Expected Response

```json
{
  "invitation": {
    "id": "inv_456",
    "status": "revoked"
  }
}
```

## Verification

- Fetch the invitation list using `GET /api/hosted/workspaces/ws_123/invitations` and verify that `inv_456` is present with `status: "revoked"`.

## Audit Checks

- Check the `hosted_workspace_audit` logs for an event with `action: "invitation.revoked"`.

## Rollback

- Invitations cannot be un-revoked. To replace one, issue `POST /api/hosted/workspaces/ws_123/invitations` with `{"recipientEmail":"user@example.com","role":"member"}`.
