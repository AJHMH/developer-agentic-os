# 32: Operational Automation And Incident Response

**Triage:** ready-for-agent

**What to build:** Add a provider-neutral operational automation layer that runs local schedules and provider events, groups failures into Operational Incidents, diagnoses them through typed Skills, and performs only approved bounded recovery actions.

**Blocked by:** None. This extends the completed Phase Three and Integration Operations boundaries.

## Problem Statement

Developer Agentic OS currently requires the developer to open the application
and manually start most workflows. Provider failures, missed schedules,
repeated incidents, and interrupted work can remain unseen or require checking
several external dashboards. The developer needs dependable local automation
that preserves evidence, supports diagnosis, and keeps consequential actions
under explicit control.

## Solution

Implement the complete product behavior in [spec.md](../../../spec.md):
provider-neutral event normalization, schedule and provider-event triggers,
repository-local policies, a local-first executor, Operational Incident
grouping, read-only Sentry diagnostics, approval-gated reversible actions,
bounded retries, restart catch-up, audit history, and cross-repository safety.

## Acceptance Criteria

- [x] Scheduled and provider events use one normalized, repository-scoped
      contract with stable deduplication.
- [x] Related Incoming Signals group into Operational Incidents without losing
      source events or provenance.
- [x] Local automation has explicit enable, pause, resume, cancellation, and
      visible lifecycle state.
- [x] Repository-local policies control triggers, workflows, approval, retries,
      catch-up, and enablement without storing credentials.
- [x] Sentry provides read-only normalized diagnostics with deterministic
      success and failure fixtures.
- [x] Typed Skills provide diagnostic workflows through the existing registry.
- [x] Failed GitHub Actions can be rerun and failed Vercel deployments can be
      redeployed only after approval.
- [x] Retries, interruptions, missed schedules, restart catch-up, and global
      pause are durable and inspectable.
- [x] Consequential actions have immutable provider evidence and complete audit
      records.
- [x] Work Items, Skill Runs, Artifacts, Inbox Signals, Focus Board entries,
      and Second Brain links retain explicit provenance.
- [x] Two Repository Contexts remain isolated across ingestion, automation,
      incidents, actions, reset, and inspection.
- [x] Existing Phase Three and Integration Operations browser flows remain
      green.

## Testing Seam

The primary test seam is operational orchestration: normalize an event, evaluate
policy, group or attach an Incident, execute safe steps or await approval, and
persist the result. Tests should assert resulting records and user-visible
behavior rather than internal helper calls or provider SDK details.

## Status

closed

## Implementation Follow-up: Gaps 33-42

### Research notes

- The command-centre loads repository-scoped Focus Board data, but operational runs are currently rendered as non-interactive rows with no run inspector.
- `PATCH /api/operational/runs/:id` already supports approval, pause, resume, retry, and cancel; `POST /api/operational/runs/:id/action` already supports approved `github-rerun` and `vercel-redeploy` actions and writes audit records.
- `createOperationalExecutor` currently runs one policy immediately and is not called by `createLocalBackgroundExecutor`; the routine executor already owns the durable lease and per-repository iteration needed for integration.
- Existing focused seams are `tests/operational-automation.test.ts`, `tests/local-background-executor.test.ts`, and `tests/e2e/dashboard.spec.ts`.

### Execution decision

This follow-up spans one user-facing control surface, one shared background execution path, and their tests. It is therefore treated as three adjacent implementation slices with validation between slices, but remains in this issue because the slices share the existing operational run contract and must ship together. No scenario-specific execution or breakdown hint files are present in this repository.

### Planned changes

1. Add clickable operational run rows and a repository-scoped inspector with approval, provider action, pause/resume/cancel controls, audit/result visibility, and refresh behavior.
2. Make the local background executor recover interrupted operational runs and evaluate due schedule policies using the same durable lease.
3. Add focused API/unit assertions and Playwright coverage for approval/provider-action controls plus operational visibility and pause/resume behavior.
