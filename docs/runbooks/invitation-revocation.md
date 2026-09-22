# Invitation Revocation Runbook

## Prerequisites
- Target workspace must be active or pending.
- Access required: Hosted Workspace Owner or system Admin.

## Least-Privilege Access
- Revocation must be performed using the `DELETE /api/hosted/workspaces/:workspaceId/invitations/:invitationId` endpoint to ensure proper audit logging.
- Do not manually delete records from the Postgres `hosted_workspace_invitations` table.

## Execution
### Request
```http
DELETE /api/hosted/workspaces/ws_123/invitations/inv_456 HTTP/1.1
Authorization: Bearer ***
X-API-Version: 2026-09-01
```

### Expected Response
```json
{
  "ok": true,
  "status": "revoked"
}
```

## Verification
- Fetch the invitation list using `GET /api/hosted/workspaces/ws_123/invitations`. The revoked invitation should no longer appear.

## Audit Checks
- Check the `hosted_workspace_audit` logs for an event with `action: "invitation.revoked"`.

## Rollback
- Invitations cannot be un-revoked. To rollback, issue a new invitation using `POST /api/hosted/workspaces/ws_123/invitations`.
