# 34: Operational Incident Grouping

**What to build:** Related Operational Events and Incoming Signals appear as one Operational Incident while preserving every original signal, source identifier, timestamp, and Repository Context.

**Blocked by:** 33: Operational Event Contract

**Status:** closed

- [x] Related events can be correlated into a repository-scoped Operational Incident.
- [x] Existing Incoming Signals remain durable and link to the Incident rather than being replaced.
- [x] Incident inspection exposes all linked events, signals, providers, timestamps, and failure details.
- [x] Duplicate events do not create uncontrolled duplicate Incidents or Signals.
- [x] Cross-repository event and Incident access is rejected.
- [x] Unit, route, and browser tests cover grouping, evidence preservation, deduplication, and isolation.
