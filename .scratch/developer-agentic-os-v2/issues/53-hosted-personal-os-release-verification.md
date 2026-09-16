# 53: Hosted Personal OS Release Verification

**What to build:** The complete hosted workflow passes across two private Workspaces and two Repository Contexts: sign in, migrate selected data, connect a scoped repository, run a read-only Skill, handle connector offline state, inspect audit history, export data, revoke access, and verify isolation.

**Blocked by:** 44: Hosted Identity And Private Workspaces; 45: Hosted Domain Persistence; 46: Local Data Export And Selective Import; 47: Local Connector Registration And Revocation; 48: Connector Capability Grants; 49: One-Way Repository Publication And Offline State; 50: Hosted Provider Credentials; 51: Hosted Automation And Approval Continuity; 52: Hosted Export And Backup

**Status:** ready-for-agent

- [ ] Two private Workspaces and two Repository Contexts remain isolated end to end.
- [ ] Sign-in, migration, connector registration, capability grants, read-only Skill execution, and export work together.
- [ ] Offline local workflows are pending, hosted-safe workflows continue, and stale state cannot authorize mutations.
- [ ] Connector and provider revocation take effect immediately.
- [ ] Audit history proves ownership, grants, approvals, actions, and revocations.
- [ ] Existing local command-centre and operational automation regression coverage remains green.
- [ ] Full unit, route, connector, browser, lint, typecheck, and production-build validation passes.
