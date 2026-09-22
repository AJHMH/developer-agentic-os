# Staging Drills

This document records the execution and outcomes of routine operational drills in the staging environment.

## Drill: Persistence Rollback (2026-09)
- **Objective:** Verify Neon Point-in-Time Restore (PITR) successfully recovers a corrupted tenant workspace without data loss prior to the corruption.
- **Outcome:** Success.
- **Limitations:** The entire database branch rolls back; cross-tenant operations are affected if executed on the shared instance.
- **Follow-up:** Investigate logical replication or per-tenant logical backups for targeted recovery.

## Drill: Artifact Recovery (2026-09)
- **Objective:** Verify that soft-deleted artifacts can be restored by an infrastructure engineer.
- **Outcome:** Success.
- **Limitations:** No user-facing API for this yet.
- **Follow-up:** None.

## Drill: Interrupted Migration Resume (2026-09)
- **Objective:** Simulate a crash during legacy memory migration and verify the `resumeFrom` correlation token successfully idempotently continues the process.
- **Outcome:** Success.
- **Limitations:** Quarantined items are skipped entirely.
- **Follow-up:** None.

## Drill: Invitation Revocation (2026-09)
- **Objective:** Revoke a pending invitation and verify that the target user cannot accept it.
- **Outcome:** Success.
- **Limitations:** Requires manual API curl; no UI currently.
- **Follow-up:** Add command-centre UI for revocation.

## Drill: Sync Conflict Recovery (2026-09)
- **Objective:** Simulate a concurrent `git push` modifying the same artifact as a hosted automation run, verify the conflict is recorded, and resolve it using `force_hosted`.
- **Outcome:** Success.
- **Limitations:** None.
- **Follow-up:** None.
