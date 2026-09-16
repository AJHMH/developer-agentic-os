# 39: Approval-Gated Recovery Actions

**What to build:** A developer can review and approve a proposed GitHub Actions rerun or Vercel redeploy; the action executes only after approval and records immutable provider evidence and audit history.

**Blocked by:** 36: Local Scheduled Automation; 37: Sentry Event Ingestion

**Status:** closed

- [x] Failed GitHub Actions can produce a rerun proposal.
- [x] Failed Vercel deployments can produce a redeploy proposal.
- [x] Provider actions are opt-in and blocked until the associated Automation Run is approved.
- [x] Approval records actor, timestamp, reviewed inputs, and proposed actions.
- [x] Material input changes invalidate the prior approval.
- [x] Successful and failed provider responses are retained as immutable audit evidence.
- [x] Unit, route, and browser tests cover approval enforcement and both provider action outcomes.
