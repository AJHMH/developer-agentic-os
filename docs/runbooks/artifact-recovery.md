# Artifact Recovery Runbook

## Prerequisites

- The target workspace ID and the Artifact ID.
- Access required: Infrastructure Engineer.

## Least-Privilege Access

- Must be performed via database queries directly against the `hosted_records` or `hosted_objects` table if soft-deleted, or via point-in-time restore for hard-deleted records.

## Execution

### Request

If an artifact was deleted through normal workflows, it may only be removed from the active projection. Run the following to identify orphaned artifacts:

```sql
SELECT id, status, payload FROM hosted_records
WHERE tenant_id = 'tenant_xyz' AND id = 'artifact_123';
```

If it exists but is marked deleted, update its status:

```sql
UPDATE hosted_records SET status = 'active'
WHERE tenant_id = 'tenant_xyz' AND id = 'artifact_123';
```

## Verification

- The user can run `GET /api/hosted/domain?workspaceId=ws_123&view=records` and inspect the recovered `artifacts` collection.

## Audit Checks

- Manual database interventions are logged by the database provider's audit trail (e.g. Neon query logs).

## Rollback

- Re-run the delete mutation from the UI or API to soft-delete it again.
