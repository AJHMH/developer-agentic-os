# 41: Operational Command Centre Surfaces

**What to build:** Agent Inbox, Focus Board, Integration Operations, and Inspector surfaces expose active Incidents, pending approvals, failed or paused runs, audit records, and applicable actions without duplicating existing domain stores.

**Blocked by:** 34: Operational Incident Grouping; 38: Event-Triggered Diagnosis; 39: Approval-Gated Recovery Actions; 40: Retry, Pause, And Restart Recovery

**Status:** closed

- [x] Agent Inbox exposes unresolved operational Signals and their Incident context.
- [x] Focus Board exposes active Incidents, pending approvals, and failed or paused Automation Runs for the active Repository Context.
- [x] Inspector surfaces expose diagnosis, approval, retry, pause, cancellation, and audit actions where applicable.
- [x] Existing Work Item, Skill Run, Artifact, Integration, and Second Brain services remain the source of truth.
- [x] User-visible states distinguish awaiting approval, retrying, paused, failed, succeeded, and missed work.
- [x] Browser tests cover the complete operational workflow without horizontal overflow or cross-repository leakage.
