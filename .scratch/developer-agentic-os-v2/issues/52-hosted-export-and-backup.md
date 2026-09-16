# 52: Hosted Export And Backup

**What to build:** A developer can export hosted Workspaces, Artifacts, relationships, provenance, approvals, and audit history into a restorable backup package without exposing credentials.

**Blocked by:** 45: Hosted Domain Persistence; 46: Local Data Export And Selective Import

**Status:** closed

- [x] A developer can export a selected hosted Workspace or its records.
- [x] The backup includes relationships, provenance, Artifact references, approvals, and audit history.
- [x] Credentials and secret values are excluded from the backup.
- [x] The package is versioned, reviewable, and suitable for restoration.
- [x] Export failures are retryable without partial data being presented as complete.
- [x] Unit, route, and browser tests cover export contents, secret exclusion, and restoration metadata.

## Completion

Implemented with versioned Workspace backup export, relationship and provenance
metadata, Artifact object references, secret exclusion, and audit history.
