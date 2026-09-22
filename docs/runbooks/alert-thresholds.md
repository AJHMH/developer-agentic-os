# Alert Thresholds & Routing

This document defines the routing rules and thresholds for operational telemetry emitted by Developer Agentic OS hosted environments.

## 1. Actionable Provider Outages
- **Metric:** `hosted_telemetry` with `event: "operational_failure"` and `code: "PROVIDER_ERROR"` or `PERSISTENCE_UNAVAILABLE`.
- **Threshold:** > 5 occurrences in 5 minutes across multiple `tenantId`s.
- **Routing:** Page primary on-call engineer.
- **Action:** Check Vercel/Neon status. No action required for transient failures as retryable logic handles them.

## 2. Repeated Authorization Failures
- **Metric:** `hosted_telemetry` with `event: "auth_failure"`.
- **Threshold:** > 50 occurrences in 10 minutes from a single `userId`.
- **Routing:** Log to `#security-alerts` channel.
- **Action:** Investigate potential brute-force or misconfigured automated bot. Consider rotating credentials or blocking IP via WAF.

## 3. Stuck Migrations
- **Metric:** `hosted_telemetry` with `event: "migration_failure"` and `status: "partial"`.
- **Threshold:** > 1 occurrence.
- **Routing:** Log to `#ops-alerts`.
- **Action:** Follow `docs/runbooks/migration-recovery.md` using the emitted `correlationId`.

## 4. Unresolved Conflicts
- **Metric:** `hosted_telemetry` with `event: "sync_conflict"`.
- **Threshold:** > 20 occurrences for a single `tenantId` in 1 hour.
- **Routing:** Log to `#ops-alerts` channel.
- **Action:** Follow `docs/runbooks/sync-conflict-recovery.md`. Verify if the client connector is stuck in a bad state.

## 5. Recovery Failures
- **Metric:** `hosted_telemetry` where `details.action` contains `recovery` or `rollback` and event is `operational_failure`.
- **Threshold:** > 0 occurrences (Any failure during a recovery runbook).
- **Routing:** Page primary on-call engineer immediately.
- **Action:** Manual intervention required to un-brick the target environment.
