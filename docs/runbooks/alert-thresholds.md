# Alert Thresholds & Routing

This document defines the routing rules and thresholds for operational telemetry emitted by Developer Agentic OS hosted environments. 

*(Note: Telemetry has no configured alert integration by default. emitTelemetry writes to stderr. To produce actionable alerts, Datadog or an equivalent external collector must be configured out of band).*

## 1. Actionable Provider Outages

- **Metric:** `hosted_telemetry` with `event: "operational_failure"` and `code: "PERSISTENCE_UNAVAILABLE"`.
- **Threshold:** > 5 occurrences in 5 minutes across multiple `tenantId`s.
- **Routing:** Page primary on-call engineer.
- **Action:** Check Vercel/Neon status. No action required for transient failures as retryable logic handles them.

## 2. Repeated Authorization Failures

- **Metric:** `hosted_telemetry` with `event: "operational_failure"` and `code: "FORBIDDEN"`.
- **Threshold:** > 50 occurrences in 10 minutes from a single `userId`.
- **Routing:** Log to `#security-alerts` channel.
- **Action:** Investigate potential brute-force or misconfigured automated bot. Consider rotating credentials or blocking IP via WAF.

## 3. Stuck or Quarantined Migrations

- **Metric:** `hosted_telemetry` with `event: "migration_failure"`.
- **Threshold:** > 1 occurrence.
- **Routing:** Log to `#ops-alerts`.
- **Action:** Follow `docs/runbooks/migration-recovery.md` using the emitted `correlationId`.

## 4. Unresolved Conflicts

- **Metric:** `hosted_telemetry` with `event: "sync_conflict"` and `status: "pending"`.
- **Threshold:** > 20 occurrences for a single `tenantId` in 1 hour.
- **Routing:** Log to `#ops-alerts` channel.
- **Action:** Follow `docs/runbooks/sync-conflict-recovery.md`. Verify if the client connector is stuck in a bad state.

## 5. Recovery Failures

- **Metric:** `hosted_telemetry` with `event: "operational_failure"` originating from a recovery runbook execution endpoint.
- **Threshold:** > 0 occurrences.
- **Routing:** Page primary on-call engineer immediately.
- **Action:** Manual intervention required to un-brick the target environment.
