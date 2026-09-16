# 33: Operational Event Contract

**What to build:** The system accepts scheduled and provider observations through one repository-scoped event model, deduplicates repeated delivery, persists event history, and exposes events in a user-visible operational view.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] Scheduled and provider observations are represented by one normalized Operational Event contract.
- [x] Events retain trigger type, source/provider, capability, timestamp, source identifier, and Repository Context.
- [x] Repeated delivery is deduplicated without losing the first source evidence.
- [x] Events are persisted and listed through a typed API.
- [x] A user can inspect the event and its provenance in the command centre.
- [x] Unit, route, and browser tests cover success, malformed input, deduplication, and repository isolation.
