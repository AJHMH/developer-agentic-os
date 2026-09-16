---
title: Routines Scheduling Contract
parent: ../map.md
labels:
  - wayfinder:grilling
status: closed
assignee: GitHub Copilot
blocked_by:
  - tickets/product-scope-for-first-build.md
  - tickets/previous-backend-reuse-inventory.md
---

## Question

How should routines be scheduled, displayed, manually triggered, paused, and recorded in the first build?

Resolve which default routines are real, how schedule status maps to UI states, and whether the previous routine scheduler is reused directly or reshaped.

## Resolution Comment

Developer Agentic OS v2 will ship routines as real manual workflows with schedule-aware display in the first build, while deferring true background workers.

Routine decisions:

- Routine mode: manual trigger first, schedule-aware display second. Show routine times and statuses, allow Run Now, and record history.
- Background scheduling: defer true background execution until the core app is stable.
- Real first-build routines: `nightly_repo_digest`, `weekly_sprint_digest`, and `release_readiness_scan`.
- Placeholder routines: `stale_branch_check` and `artifact_cleanup` until branch inventory and artifact retention behavior are stronger.
- Routine statuses: `queued`, `next`, `running`, `succeeded`, `failed`, `paused`, and `missed`.
- UI vocabulary: the interface may display `Fired` for completed routines, but the internal status is `succeeded`.
- Routine output: every run creates a Routine Execution Record. Durable outputs are separate Artifacts linked by ID.
- Routine/skill relationship: routines invoke SkillRegistry handlers where possible, so `weekly_sprint_digest` uses the same behavior as `/sprint-digest`.
- Pause/resume: supported per routine. Paused routines stay visible, do not auto-run later, and can be manually run with confirmation.
- Previous scheduler reuse: reuse behavior contracts from the previous Python scheduler, but port routine registration, listing, run-now behavior, due-status calculation, and artifact-backed history into TypeScript.
