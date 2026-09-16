# 51: Hosted Automation And Approval Continuity

**What to build:** Hosted-safe schedules and provider events run without the local connector, local-repository workflows wait visibly, and approval-gated provider actions preserve the existing Automation Run lifecycle, current-evidence requirement, and immutable audit trail.

**Blocked by:** 49: One-Way Repository Publication And Offline State; 50: Hosted Provider Credentials

**Status:** ready-for-agent

- [ ] Hosted-safe schedules and provider events execute without local filesystem access.
- [ ] Local-repository workflows become pending when the connector is offline.
- [ ] Approval, retry, pause, cancellation, and audit semantics match the local operational model.
- [ ] Provider mutations require current connector evidence and explicit approval.
- [ ] Hosted Automation Runs preserve Workspace, Repository Context, Signal, Incident, and provenance links.
- [ ] Unit, route, provider-fixture, and browser tests cover offline execution, approval, audit, and isolation.
