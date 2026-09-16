# 47: Local Connector Registration And Revocation

**What to build:** A developer can register an outbound local connector, see its connection state, revoke it, and verify that expired or revoked connectors can no longer access hosted Workspaces.

**Blocked by:** 44: Hosted Identity And Private Workspaces; 45: Hosted Domain Persistence

**Status:** closed

- [x] A local connector registers through an outbound authenticated flow.
- [x] Connector identity, expiry, and connection state are visible without exposing secrets.
- [x] A developer can revoke a connector immediately.
- [x] Expired and revoked connectors are rejected at the hosted boundary.
- [x] Connector registration, use, expiry, and revocation are auditable.
- [x] Unit, route, connector-fixture, and browser tests cover lifecycle and isolation.

## Completion

Implemented with explicit outbound connector registration, expiry, offline,
revocation, ownership checks, and audit events.
