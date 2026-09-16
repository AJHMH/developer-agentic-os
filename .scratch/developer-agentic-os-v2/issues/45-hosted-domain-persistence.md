# 45: Hosted Domain Persistence

**What to build:** Authenticated users can persist and query Repository Contexts, Work Items, Incoming Signals, Incidents, Automation Runs, approvals, and audit records in hosted storage, with large Artifacts stored separately.

**Blocked by:** 44: Hosted Identity And Private Workspaces

**Status:** ready-for-agent

- [ ] Hosted indexed state is stored transactionally within the authenticated user's Workspace.
- [ ] Domain relationships and provenance survive reads and writes.
- [ ] Large Artifact content is stored separately while metadata remains queryable.
- [ ] Hosted records cannot be accessed by another user or Workspace.
- [ ] Audit records are immutable after creation.
- [ ] Unit and route tests cover persistence, relationships, isolation, and failures.
