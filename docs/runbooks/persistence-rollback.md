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
- Run the health check endpoint `GET /api/hosted/health` to verify database connectivity.
- Verify that recent telemetry reflects the expected older state (no new mutations after the PITR timestamp).

## Audit Checks
- Provider-level audit logs (Neon) will record the restore operation.

## Rollback
- Point-in-time restores create new database branches in Neon. If the restore was incorrect, swap the connection string back to the original branch.
