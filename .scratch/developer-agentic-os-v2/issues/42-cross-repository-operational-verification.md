# 42: Cross-Repository Operational Verification

**What to build:** The complete scheduled and provider-event workflows pass across two isolated Repository Contexts, including reset behavior, provenance, browser flows, and regression coverage for Phase Three and Integration Operations.

**Blocked by:** 33: Operational Event Contract; 34: Operational Incident Grouping; 35: Repository Automation Policies; 36: Local Scheduled Automation; 37: Sentry Event Ingestion; 38: Event-Triggered Diagnosis; 39: Approval-Gated Recovery Actions; 40: Retry, Pause, And Restart Recovery; 41: Operational Command Centre Surfaces

**Status:** closed

- [x] A scheduled workflow passes end to end in two isolated Repository Contexts.
- [x] A provider-event workflow passes end to end through normalization, Incident grouping, diagnosis, approval, action, and audit inspection.
- [x] Events, Incidents, policies, runs, Signals, actions, and outputs cannot cross repository boundaries.
- [x] Reset clears only the selected repository's operational state.
- [x] Existing Phase Three and Integration Operations unit, route, and browser behavior remains green.
- [x] Full lint, typecheck, unit, E2E, and production-build validation passes.
