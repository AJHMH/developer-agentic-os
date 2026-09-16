# Operational Automation And Incident Response

## Problem Statement

Developer Agentic OS currently requires the developer to open the application
and manually start most workflows. Provider failures, missed schedules,
repeated incidents, and interrupted work can remain unseen or require checking
several external dashboards. The developer needs dependable local automation
that preserves evidence, supports diagnosis, and keeps consequential actions
under explicit control.

## Status

Drafted from the approved next-phase decisions on 2026-09-06.

## Purpose

Developer Agentic OS currently provides a repository-scoped daily workflow for
Incoming Signals, Work Items, Skills, Routines, Artifacts, Integrations, and
Session Handoffs. The next phase makes that workflow operationally dependable:
the system can notice scheduled and provider-reported conditions, diagnose
them through typed Skills, and propose or perform bounded recovery actions while
preserving provenance and developer control.

## Solution

Add a provider-neutral operational automation layer. It accepts scheduled and
provider events, scopes every event and action to a Repository Context, and
normalizes observations into durable records. Related Incoming Signals are
grouped into Operational Incidents without deleting source history.

A local-first executor evaluates repository-local Automation Policies. It can
run safe diagnostic workflows automatically, retry transient failures within a
bounded budget, and catch up eligible work after restart. Consequential actions
remain approval-gated. The first real provider addition is a read-only Sentry
adapter, supported by deterministic fixtures. The first reversible provider
actions are rerunning failed GitHub Actions and redeploying failed Vercel
deployments.

The contracts remain compatible with a future hosted worker, but hosted
authentication, cloud synchronization, and a hosted worker are not required
for this phase.

## User Stories

1. As a developer, I want scheduled workflows to run locally, so that routine
   operational checks do not depend on memory.
2. As a developer, I want provider events to trigger workflows, so that recent
   failures are handled without waiting for manual review.
3. As a developer, I want schedule and provider triggers to share one model,
   so that automation behavior is predictable.
4. As a developer, I want every event scoped to a Repository Context, so that
   repositories cannot receive one another's operational data.
5. As a developer, I want events to retain provider, capability, source ID,
   and observed time, so that I can identify their origin.
6. As a developer, I want duplicate deliveries deduplicated, so that one
   failure does not create noisy duplicate work.
7. As a developer, I want related failures grouped into an Operational
   Incident, so that I can work from one actionable thread.
8. As a developer, I want every source Incoming Signal preserved, so that
   grouping never destroys original evidence.
9. As a developer, I want to inspect all signals in an Incident, so that I can
   distinguish a single failure from a recurring pattern.
10. As a developer, I want Incidents to remain repository-scoped, so that
    operational context cannot leak across repositories.
11. As a developer, I want repository-local Automation Policies, so that each
    repository can define its own schedules, triggers, and actions.
12. As a developer, I want policies to be inspectable, so that I understand why
    a workflow ran or did not run.
13. As a developer, I want policies to contain no credentials, so that local
    configuration cannot expose secrets.
14. As a developer, I want to enable automation explicitly, so that opening
    the application does not unexpectedly start work.
15. As a developer, I want a global pause control, so that I can stop new
    actions while preserving history.
16. As a developer, I want per-policy pause controls, so that one problematic
    automation path does not stop everything.
17. As a developer, I want visible executor health, so that enabled, paused,
    running, failed, and idle states are understandable.
18. As a developer, I want each Automation Run to show its trigger, policy,
    inputs, steps, outputs, and result, so that execution is auditable.
19. As a developer, I want approval state visible, so that I know when work is
    waiting for my decision.
20. As a developer, I want transient failures retried within a bounded budget,
    so that temporary provider problems do not become manual work immediately.
21. As a developer, I want retry attempts and backoff recorded, so that retries
    do not conceal instability.
22. As a developer, I want exhausted retries to create an Incoming Signal, so
    that unresolved failures appear in Agent Inbox.
23. As a developer, I want missed schedules recorded after restart, so that
    work is never silently lost.
24. As a developer, I want eligible missed work caught up within a bounded
    window, so that short interruptions do not require manual recovery.
25. As a developer, I want stale work left visibly missed, so that it does not
    run unexpectedly.
26. As a developer, I want to cancel eligible runs, so that obsolete actions
    cannot proceed.
27. As a developer, I want interrupted runs to have explicit outcomes, so that
    process stops are distinguishable from success.
28. As a developer, I want Sentry errors and health data visible, so that
    application failures appear beside repository work.
29. As a developer, I want Sentry failures normalized like other provider
    events, so that triage is provider-neutral.
30. As a developer, I want Sentry setup and outage states distinguished, so
    that I know whether to fix credentials, connectivity, or code.
31. As a developer, I want deterministic provider fixtures, so that failure
    handling does not depend on live services.
32. As a developer, I want operational failures to invoke typed Skills, so
    that diagnosis avoids arbitrary shell commands.
33. As a developer, I want diagnostic Skills to produce linked Artifacts or
    Work Items, so that conclusions remain useful after the run.
34. As a developer, I want failed GitHub Actions rerunnable from the command
    centre, so that transient failures can be recovered quickly.
35. As a developer, I want failed Vercel deployments redeployable from the
    command centre, so that recovery does not require dashboard switching.
36. As a developer, I want provider actions opt-in per integration, so that a
    new connection cannot mutate external state unexpectedly.
37. As a developer, I want consequential actions to require approval, so that
    automation cannot make important changes without my decision.
38. As a developer, I want one approval to cover a reviewed run, so that I do
    not approve every harmless step separately.
39. As a developer, I want approval invalidated when inputs materially change,
    so that an old decision cannot authorize a different action.
40. As a developer, I want provider actions to record their approval, so that
    I can explain why they were allowed.
41. As a developer, I want consequential provider responses retained, so that
    actions can be investigated after provider state changes.
42. As a developer, I want failed recovery actions to remain visible, so that
    attempts are not confused with successful recovery.
43. As a developer, I want automation outputs to reuse existing Work Item,
    Skill Run, and Artifact boundaries, so that data is not duplicated.
44. As a developer, I want Incident-derived Work Items to retain signal,
    event, Incident, and Repository Context references, so that commitments
    remain traceable.
45. As a developer, I want the Focus Board to surface active Incidents and
    failed Automation Runs, so that operational work appears in my daily view.
46. As a developer, I want Agent Inbox to show unresolved operational Signals,
    so that failures use the existing triage workflow.
47. As a developer, I want Second Brain to use explicit operational links, so
    that it does not invent relationships from titles or timestamps.
48. As a developer, I want automation usable without external credentials, so
    that local and fixture-backed workflows remain testable.
49. As a developer, I want two repositories isolated during automation, so
    that one outage cannot alter another repository's state.
50. As a developer, I want reset to clear only the selected repository's
    operational data, so that troubleshooting is safe.
51. As a developer, I want existing Phase Three and Integration Operations
    flows to continue working, so that automation extends the product.
52. As a future hosted user, I want event, policy, run, approval, and audit
    contracts suitable for a hosted worker, so that local-first work transfers
    without a second product model.

## Product Outcome

One developer can leave a configured local workspace running and return to a
clear, auditable view of what happened, what failed, what was retried, and what
requires approval. The same event, automation, approval, and audit contracts
must remain suitable for a future hosted worker without requiring a second
product model.

## Scope

This phase includes:

- A provider-neutral operational event contract.
- Schedule and provider-event triggers.
- A local-first automation executor with explicit enable, pause, and resume
  controls.
- Repository-local automation policies, with a typed path to future workspace
  defaults.
- A real read-only Sentry adapter, with deterministic fixtures for tests.
- Operational Incidents that group related Incoming Signals while preserving
  every source signal and provider event.
- Typed diagnostic workflows using existing Skill Registry handlers.
- Approved reversible actions: rerun failed GitHub Actions, redeploy a failed
  Vercel deployment, and create or update local Work Items, Skill Runs, or
  Artifacts.
- Explicit approval, bounded retry, cancellation, pause, audit, and global
  pause behavior.
- Transparent missed-run records and bounded catch-up after application
  restart.
- Repository isolation and reset/migration coverage.

## User Scenarios

### Scheduled repository health

1. A repository policy schedules a health routine.
2. The local executor records a queued run and starts it when enabled.
3. The routine invokes typed Skills and provider read operations.
4. The result is recorded as an execution trace and shown in the command
   centre.
5. Failures become or attach to an Operational Incident and Incoming Signal.

### Provider failure response

1. Polling discovers an unhealthy Sentry, GitHub, or Vercel result.
2. The event is normalized with provider, repository, timestamp, source
   identifier, capability, and failure details.
3. Related events are grouped into an Operational Incident.
4. The developer can inspect evidence, run a diagnostic Skill, or create a
   Work Item.
5. A reversible provider action may be proposed and requires approval before
   execution.
6. The action result, approval, inputs, outputs, and provider response are
   recorded in the audit trail.

### Restart and recovery

1. The application stops while a schedule is due or a run is active.
2. On restart, the executor records missed or interrupted work explicitly.
3. Safe eligible work is caught up within a bounded window.
4. Work outside the window remains visible as missed and does not run
   silently.

## Domain Model

### Operational Event

An immutable normalized observation from a schedule, repository, or provider.
It includes an event ID, trigger type, repository context, source/provider,
source identifier when available, capability, observed time, payload summary,
and deduplication key.

### Incoming Signal

A triageable presentation of an event or other incoming context. It remains a
separate durable record and is never deleted when an Incident, Work Item,
Skill Run, or Artifact is created.

### Operational Incident

A repository-scoped grouping of related Incoming Signals and Operational
Events. It provides one actionable operational thread while retaining links to
all underlying evidence.

### Automation Run

A durable execution record for a triggered workflow. Its lifecycle is:

`queued -> running -> succeeded | failed | awaiting_approval | retrying | paused | cancelled`

Every run records its trigger, policy, inputs, steps, outputs, status changes,
approval decision, retry history, and final result.

### Automation Policy

A repository-local, typed rule that defines triggers, eligible workflows,
approval requirements, retry limits, catch-up limits, and enablement. Policies
must not contain credentials.

### Approval

An explicit decision on an automation run containing one or more proposed
actions. Approval is scoped to that run, expires when the run changes materially,
and is recorded with the approving actor and timestamp.

## Requirements

### Event and incident handling

- **REQ-001**: The system shall normalize scheduled and provider events behind
  one provider-neutral contract.
- **REQ-002**: Events shall be scoped to exactly one Repository Context.
- **REQ-003**: Duplicate delivery shall not create duplicate events or
  uncontrolled duplicate signals.
- **REQ-004**: Related events shall be groupable into an Operational Incident
  without replacing or deleting their Incoming Signals.
- **REQ-005**: Incident and signal views shall expose provider, source event,
  repository, timestamps, failure details, and provenance.

### Automation

- **REQ-006**: The executor shall support both schedule and provider-event
  triggers.
- **REQ-007**: The local executor shall have visible enabled, paused, running,
  failed, and last-run state.
- **REQ-008**: Automation policies shall be repository-local and inspectable.
- **REQ-009**: The executor shall support bounded retries with explicit
  retrying state and backoff metadata.
- **REQ-010**: Safe eligible work shall support bounded catch-up after restart;
  missed work shall be recorded when it is not eligible.
- **REQ-011**: A global pause shall prevent new automation actions while
  preserving history and inspection.

### Diagnosis and actions

- **REQ-012**: Sentry shall provide a real read-only adapter with normalized
  error and health results.
- **REQ-013**: Deterministic provider fixtures shall support success,
  authentication, timeout, rate-limit, unavailable, and unhealthy cases.
- **REQ-014**: Diagnostic workflows shall invoke Skills through the existing
  Skill Registry rather than arbitrary shell commands.
- **REQ-015**: The first provider actions shall be rerunning failed GitHub
  Actions and redeploying failed Vercel deployments.
- **REQ-016**: Provider actions shall be opt-in, reversible where supported,
  and blocked until the associated automation run is approved.
- **REQ-017**: Local Work Items, Skill Runs, and Artifacts may be created or
  updated as automation outputs under their existing service boundaries.

### Trust and history

- **REQ-018**: Runs shall record trigger, inputs, steps, outputs, approvals,
  retries, and result.
- **REQ-019**: Consequential provider actions shall retain immutable provider
  responses in their audit record.
- **REQ-020**: Failed or exhausted runs shall create or update an Incoming
  Signal and link it to the relevant Incident.
- **REQ-021**: Every derived Work Item, Skill Run, Artifact, and Incident shall
  preserve Repository Context and source provenance.
- **REQ-022**: Users shall be able to pause or cancel eligible runs without
  corrupting existing records.

### Compatibility and isolation

- **REQ-023**: Existing Inbox, Work Queue, Focus Board, Skills, Routines,
  Artifacts, Integrations, Handoffs, Workspace Switcher, and Second Brain
  behavior shall remain functional.
- **REQ-024**: Two Repository Contexts shall remain isolated across event
  ingestion, incidents, policies, runs, signals, actions, and reset behavior.
- **REQ-025**: The event contract shall support future webhook delivery without
  changing triage or automation semantics; polling is the initial delivery
  mechanism.
- **REQ-026**: Hosted workers, authentication, cloud synchronization, and
  workspace-level policy defaults shall remain future-compatible boundaries,
  not first-release dependencies.

## Release Acceptance

The phase is complete when all of the following are true:

1. A scheduled local workflow runs end to end, records its execution trace, and
   produces the expected local outputs.
2. A provider event runs end to end through normalization, Incident grouping,
   Inbox presentation, diagnosis, approval, and an auditable reversible action.
3. Sentry read-only diagnostics work with configured credentials and with
   deterministic fixtures.
4. Retry, pause, cancellation, global pause, restart catch-up, and missed-run
   behavior are observable and tested.
5. The complete workflow passes across two isolated Repository Contexts.
6. Reset and clean-store behavior preserve the repository boundary and do not
   destroy another repository's records.
7. Existing Phase Three and Integration Operations browser flows remain green.
8. The trust gate passes: no consequential action occurs without an approval
   record, and every consequential action has immutable evidence.

## Validation

Focused tests shall cover event normalization, incident grouping, deduplication,
policy evaluation, lifecycle transitions, retry and catch-up behavior, Sentry
fixtures, approval enforcement, action audit records, and repository isolation.

Browser tests shall cover enabling and pausing automation, viewing an Incident,
diagnosing through a Skill, approving a reversible action, inspecting its audit
record, restarting with missed work, and switching Repository Contexts.

The full validation commands remain:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

## Out Of Scope

- Fully autonomous consequential provider mutations.
- GitHub merges, issue mutations, or broad provider-side administration.
- Sending or replying to Email.
- Full Sentry issue management or alert-rule administration.
- Webhook-only delivery or a hosted worker.
- Hosted authentication, multi-user Workspaces, permissions, billing, or cloud
  synchronization.
- Automatic session-end detection or automatic Handoff creation.
- A general-purpose workflow builder or project-management suite.
- Automatic migration from the previous Python application's `.memory`
  directory.
