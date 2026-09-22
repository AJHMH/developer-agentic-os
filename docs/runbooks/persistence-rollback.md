# Persistence Rollback Runbook

## Prerequisites

- A recent PostgreSQL backup or active Read Replica.
- Access required: Infrastructure Engineer.

## Least-Privilege Access

- Must be performed via infrastructure tooling (e.g., Neon dashboard or terraform), not the application API.

## Execution

### Request

Use Neon's branch/restore feature to restore the database state to a specific Point-in-Time (PITR).

## Verification

- Run authenticated `GET /api/hosted/workspaces/ws_123` to verify hosted persistence connectivity and workspace access.
- Verify the absence of post-restore mutations via a database/audit query.

## Audit Checks

- Provider-level audit logs (Neon) will record the restore operation.

## Rollback

- Point-in-time restores create new database branches in Neon. If the restore was incorrect, swap the connection string back to the original branch.
