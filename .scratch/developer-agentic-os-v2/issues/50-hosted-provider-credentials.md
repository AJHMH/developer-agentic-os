# 50: Hosted Provider Credentials

**What to build:** A developer can connect provider credentials through OAuth or a protected secrets boundary, inspect scopes and health without seeing secrets, and revoke credentials without exposing them in browser state or repository records.

**Blocked by:** 44: Hosted Identity And Private Workspaces; 45: Hosted Domain Persistence

**Status:** ready-for-agent

- [ ] OAuth and non-OAuth credentials use a provider-neutral protected boundary.
- [ ] Plaintext secrets never appear in browser state, Workspace records, or status responses.
- [ ] A developer can inspect provider identity, scopes, expiry, and health without seeing secret values.
- [ ] Credentials are scoped to the correct user and Workspace.
- [ ] Credentials can be revoked and rejected immediately.
- [ ] Unit, route, provider-fixture, and browser tests cover storage, scopes, revocation, and isolation.
