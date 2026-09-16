# 49: One-Way Repository Publication And Offline State

**What to build:** A connected repository publishes local-derived state and freshness metadata to hosted storage; when the connector is offline, hosted-safe workflows continue while local workflows become visibly pending and stale state cannot authorize provider mutations.

**Blocked by:** 45: Hosted Domain Persistence; 48: Connector Capability Grants

**Status:** closed

- [x] A granted connector publishes Repository Context snapshots one way to hosted state.
- [x] Published local-derived data includes freshness and source metadata.
- [x] Hosted-owned records remain writable only through hosted APIs.
- [x] Hosted-safe workflows continue while local-repository workflows become pending offline.
- [x] Historical data is visibly stale and cannot authorize provider mutations.
- [x] Reconnection resumes pending work safely without bidirectional conflict merging.
- [x] Unit, route, connector, and browser tests cover publication, freshness, offline state, and isolation.

## Completion

Implemented with one-way snapshot publication, connector-bound freshness,
offline pending work, reconnection/resume behavior, and stale-state mutation
denial.
