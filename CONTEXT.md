# Context

## Purpose

Developer Workflow OS v2 is a visual operating surface for a builder's agentic work: micro apps, skills, routines, artifacts, communication signals, and workspace memory shown in one command centre.

## Canonical Terms

### Agentic OS

The whole operating surface that coordinates human work, AI skills, scheduled routines, and workspace memory. It is a dashboard for action, not a marketing page or chat transcript.

### Micro App

A small focused tool exposed inside the OS, such as Generations, Teleprompter, Second Brain, or Excalidraw. A micro app is opened by the user and represents a durable utility.

### Skill

A runnable AI action card with a selected model and effort level. A skill is manually triggered unless a routine calls it.

### Skills Deck

The collection of available skill cards. Each card shows the command, model, effort level, run action, and configuration action.

### Skill Command

A typed runnable skill definition. It includes display information, model and effort defaults, input requirements, execution status, and a handler.

### Skill Registry

The catalog of Skill Commands available to the Skills Deck and routines.

### Routine

A scheduled workflow that fires at a planned time. A routine can run one or more skills or desktop tasks without the user manually pressing run.

### Manual Routine

A routine that the user starts explicitly from the command centre.

### Schedule-Aware Routine

A routine that has planned timing and status display even when first-build background execution is deferred.

### Artifact

A persistent output from work, such as a plan, brief, risk note, release memo, or generated asset. In v2, artifacts occupy the lower-left activity area formerly reserved for the previous attempt's media widget.

### Second Brain

The central workspace memory graph. It shows connected work, tools, and signals as a navigable constellation rather than a flat list.

### Graph Node

A typed item rendered in the Second Brain graph.

### Graph Link

A typed relationship between two Graph Nodes.

### Context Reference

An explicit pointer from an artifact or skill output to the repo file or area it used.

### Inspector Panel

The command-centre surface opened when a user selects a Second Brain node.

### Command Centre

The first screen of the OS. It combines micro apps, time, artifacts, workspace graph, communication triage, skills, and routines.

### First Build

The first product-grade milestone of Developer Agentic OS. It runs locally, uses real data for the developer workflow core, and allows non-core integrations to appear as placeholders until they are connected.

### Main App Runtime

The primary framework and execution environment for Developer Agentic OS. For the first build, this is Next.js App Router with TypeScript.

### Local-First

A product mode where the first usable build runs on the developer's machine without hosted accounts, cloud databases, or external deployment setup.

### Service Boundary

A separately deployed or separately run backend surface reserved for workloads that should not live in the main app runtime.

### Local Store

The first-build filesystem storage root for Developer Agentic OS state. By default, this is `.developer-agentic-os/` in the app workspace.

### Integration Adapter

A typed boundary for an external or local tool connection. It reports identity, kind, status, capabilities, and setup guidance.

### Available Integration

An integration that is supported by the product but not currently connected or required.

### Connected Integration

An integration with enough local configuration or credentials to provide live data.

### Repo Memory Snapshot

A refreshable JSON record of repository structure and related workspace signals used by the Second Brain and developer workflow skills.

### Skill Run Record

A structured record of a skill execution, including status and execution metadata. It is distinct from the durable artifact a successful run may produce.

### Built-In Skill

A first-build Skill Command implemented by Developer Agentic OS itself.

### Placeholder Skill

A Skill Command shown in the interface before its real handler exists.

### Routine Execution Record

A structured record of a routine run. It links to produced artifacts by ID rather than duplicating their contents.

### Routine Status

The lifecycle state of a routine: `queued`, `next`, `running`, `succeeded`, `failed`, `paused`, or `missed`.

### Integration Status

The state of an Integration Adapter or its latest health result: `connected`, `healthy`, `unhealthy`, `unconfigured`, `deferred`, `available`, `disabled`, or `error`.

### Integration Operation

A normalized read or inspection result from a provider adapter, such as GitHub Issues, Pull Requests, Actions, merge status, or Vercel deployments and log links.

### Integration Failure Signal

An Agent Inbox Incoming Signal created from an unhealthy provider result. It preserves the provider, stable source event identifier, Repository Context, timestamp, and failure details.

### Live Widget

A command-centre widget backed by real local state, persisted data, or an implemented workflow.

### Placeholder Widget

A command-centre widget that shows realistic product shape without requiring an external integration or complete workflow in the first build.

### Resizable Widget

A command-centre panel or card that can be adjusted within the page while remaining bounded by the dashboard layout.

### Reset Layout

A command-centre action that restores the approved baseline dimensions for the page, central orbit, widgets, and cards.

### Content-Safe Minimum

The smallest allowed size for a resizable element before it would hide its title/action row or all meaningful content.

### Phase Three

The next product milestone after the first-build and Phase Two work. Phase Three focuses on reliable daily use for one developer working across multiple local repositories while remaining local-first.

### Agent Inbox

A source-neutral Micro App for unprocessed incoming context such as email signals, routine failures, notifications, and manually captured notes. It triages incoming context into dismissal, snoozing, Work Items, Skills, or Artifacts.

### Today / Focus Board

A Micro App that organizes the active Repository Context's current Work Items, due items, blocked items, recent Artifacts, and recommended next actions into one daily operating view.

### Session Handoff

A Micro App that captures the current work state, decisions, changes, blockers, and next actions as a durable handoff Artifact for a later session or agent.

### Operational Event

An immutable normalized observation from a schedule, repository, or Integration Adapter that may start an automated workflow.

### Operational Incident

A repository-scoped grouping of related Incoming Signals and Operational Events that gives the developer one actionable operational thread without replacing its source evidence.

### Automation Run

A durable record of a triggered workflow, including its lifecycle, trigger, actions, approvals, retries, and result.

### Automation Policy

A repository-scoped rule describing which triggers and workflows are enabled, what approval is required, and how retries or missed work are handled.

### Approval

An explicit developer decision allowing a proposed Automation Run action to proceed.

### Hosted Workspace

A private hosted space owned by a User that contains Repository Contexts and hosted workflow records.

### Workspace Member

A User invited to access a Hosted Workspace under a workspace-scoped Workspace Role.

### Workspace Role

A workspace-scoped access level assigned to a Workspace Member: owner, admin, or member.

### Sync Conflict

A required, human-reviewable record for a consequential or destructive divergence between Local-Derived State and Hosted State, or for any divergence a domain merge rule cannot safely resolve. It preserves both versions and defers the authoritative result to review.

### Legacy Migration

The transfer of records from the legacy `.memory` directory into the Hosted Workspace. It is intended as a one-time operation but is safely retryable after interruption: an idempotency marker prevents re-importing already migrated records, while preserving source provenance and isolating invalid inputs.

### Local Connector

An outbound authenticated local process that exposes explicitly granted Repository Context capabilities to the Hosted Workspace.

### Capability Grant

An explicit authorization for a Local Connector or Skill to use a specific Repository Context capability.

### Hosted State

The durable account, Workspace, workflow, approval, and audit records owned by the hosted OS.

### Local-Derived State

State computed from a local repository or filesystem, whose freshness depends on a Local Connector publication.

### Migration Package

A reviewable export of local records and relationships that can be selectively imported into a Hosted Workspace.

### Freshness State

The explicit indication of whether Local-Derived State is current, historical, pending, or unavailable.

### Tenant

A Clerk organization that owns hosted application state, repository registrations, and deployment resources. Tenant is the canonical identity boundary for hosted data and access decisions.

### Repository Registration

An explicit association between a GitHub repository and a Tenant. Repository ownership is not inferred solely from request headers, repository names, or external deployment metadata.

### Vercel Project Mapping

The Tenant-owned association between a registered Tenant and its primary Vercel project and, when applicable, Vercel team. A missing mapping means deployment configuration is incomplete rather than selecting an implicit fallback.

## Clarified Distinctions

### Skill vs Routine

A skill is a discrete action. A routine is a scheduled workflow that may invoke skills.

### Manual Routine vs Background Routine

A manual routine starts only when the user invokes it. A background routine runs automatically when its schedule is due.

### Skill Command vs Slash Command

A Skill Command is the typed product model. A slash command is the user-facing label used to display or invoke it.

### Micro App vs Skill

A micro app is an always-available utility. A skill is a runnable AI task with model and effort settings.

### Artifact vs Communication Signal

An artifact is produced by the system or user work. A communication signal, such as an email item, is incoming external context that may trigger work but is not itself an artifact.

### Graph Node vs Graph Link

A Graph Node is an item in the Second Brain. A Graph Link explains the relationship between two nodes.

### Page Resize vs Widget Resize

Page resize changes the overall dashboard frame or central graph scale. Widget resize changes an individual panel or card within that frame.

### Resize vs Reorder

Resize changes an element's dimensions. Reorder changes where the element sits in the command centre layout.

### Live Widget vs Placeholder Widget

A live widget participates in the working product loop. A placeholder widget preserves the command-centre shape while its integration remains deferred.

### Main App Runtime vs Service Boundary

The main app runtime owns the product shell and first-build APIs. A service boundary is introduced only when a workload needs a separate runtime.

### Available Integration vs Connected Integration

An available integration is supported but inactive. A connected integration supplies live data or actions.

### Artifact vs Skill Run Record

An artifact is durable output for later review. A skill run record is execution history and may or may not point to an artifact.

### Built-In Skill vs Placeholder Skill

A built-in skill has a real first-build handler. A placeholder skill preserves the deck shape and can store configuration before execution exists.

### Artifact vs Routine Execution Record

A routine execution record describes that a scheduled workflow ran. Any durable result from that run lives as an artifact linked by ID.

### Context Reference vs Inferred Relationship

A Context Reference is explicitly recorded by a workflow. An inferred relationship is guessed later and is not part of the first-build graph contract.

### Routine Status vs UI Label

Routine Status is the internal state. A UI label may use display language such as `Fired` for `succeeded`.

### Communication Signal vs Work Item

A Communication Signal is incoming context that may require triage. A Work Item is an intentional actionable commitment created from a signal or directly by the developer. Signals do not become Work Items automatically.

### Incoming Signal vs Operational Incident

An Incoming Signal preserves one piece of incoming context or provider evidence. An Operational Incident groups related signals for coordinated investigation without deleting or replacing them.

### Operational Event vs Incoming Signal

An Operational Event is a normalized system observation. An Incoming Signal is the triageable product record created from an event or other incoming context.

### Automation Run vs Routine Execution Record

An Automation Run records any triggered operational workflow, including event-triggered workflows. A Routine Execution Record records the execution of a Routine and may link to Automation Runs or their outputs.

### Hosted State vs Local-Derived State

Hosted State owns account, Workspace, approval, and audit records. Local-Derived State describes filesystem or repository facts and may be published to Hosted State but does not become current merely because it exists there.

### Local Connector vs Integration Adapter

A Local Connector grants scoped access from the hosted OS to local Repository Context capabilities. An Integration Adapter connects the OS to an external provider such as GitHub, Vercel, or Sentry.

### Workspace Role vs Ownership

A Workspace Role grants ordinary workspace access. Ownership is a separate authority: only the owner may approve ownership transfer, destructive deletion, or full export.

### Automatic Merge vs Sync Conflict

Automatic merging is permitted only for additive, non-consequential changes where the domain rule preserves meaning and provenance. Any consequential or destructive change always requires a Sync Conflict and human review, even when a domain rule could technically combine the values.

### Merged Audit View vs Rewritten Audit History

A merged audit view may present local and hosted events together, but each event retains its source, actor, original timestamp, ingestion timestamp, and ordering rationale. Audit history is never rewritten into an unattributed sequence.

### Automatic Migration vs Silent Migration

Automatic migration is intended as a one-time operation, triggered without repeated manual orchestration. It remains safely retryable after interruption through an idempotency marker that prevents re-importing already migrated records, and it still provides a preflight summary, preserves provenance, and quarantines malformed or unknown inputs.

### Capability Grant vs Credential

A Capability Grant authorizes a specific action or data boundary. A Credential proves access to a provider or connector. A grant must not expose or replace the credential.

## Relationship Rules

- The command centre is the front door to the Agentic OS.
- The Skills Deck contains skills, not routines.
- The Routines panel shows schedule state, not manual skill configuration.
- The Second Brain is the central visual memory layer connecting the surrounding panels.
- Artifacts replace the media-performance widget from the earlier application direction.
- Resizable widgets must stay inside the visible command-centre layout and avoid horizontal page overflow.
- The first build uses live widgets for Artifacts, Skills Deck, Routines, Second Brain, and layout settings.
- Calendar, Email, and Micro Apps may be placeholder widgets in the first build.
- The first build's main app runtime is Next.js App Router with TypeScript.
- Python is reference material for the first build, not the main runtime.
- First-build filesystem state lives in the Local Store.
- Layout settings are client-owned until they need sync across browsers or machines.
- The first build ships built-in skills for repo summary, branch summary, release readiness, implementation checklist, and sprint digest.
- The Skills Deck runs through the Skill Registry, not arbitrary shell commands.
- First-build routines are manually triggered with schedule-aware display; automatic background execution is deferred.
- Routines should invoke Skill Registry handlers when their behavior matches a skill.
- Local git is the only mandatory first-build integration.
- GitHub and Vercel are the first actionable Integration Operations providers. GitHub exposes Issues, Pull Requests, Actions, and merge status; Vercel exposes deployments and build/runtime log links.
- GitHub uses `GITHUB_TOKEN` or `GH_TOKEN` and derives the repository from the active Repository Context's Git remote when available.
- Vercel uses `VERCEL_TOKEN` or `VERCEL_API_TOKEN` and prefers `.vercel/project.json` in the active Repository Context for project and team identity.
- Missing credentials or project configuration appear as `unconfigured`; provider failures are normalized and do not break the command centre.
- Sentry, Cloudflare, CodeRabbit, WorkOS, Clerk, Convex, NeonDB, Upstash, Email, and Slack appear as staged `deferred` or setup states without unsupported actions.
- Integration Operations refresh on dashboard load and through the manual Integration status control.
- Unhealthy GitHub and Vercel results create deduplicated `integration` Incoming Signals. Triage preserves the signal and can create a Work Item with explicit integration-event provenance.
- Integration requests, provider results, signals, and Work Items remain scoped to the active Repository Context.
- Provider integrations can be disabled independently through their configuration boundaries.
- First-build resizing persists locally and includes a Reset Layout action.
- Mobile resizing is vertical-only.
- Reordering command-centre widgets is deferred from the first build.
- The first-build Second Brain graph contains repo, area, file, artifact, and skill nodes.
- First-build graph links are contains, references, produced, and used_context.
- Artifacts connect to files or areas through explicit Context References.
- Phase Three keeps Email as a communication-signal source for Agent Inbox rather than making Email itself a Work Queue.
- Phase Three's replacement Micro Apps are Today / Focus Board, Agent Inbox, and Session Handoff; Workspace Switcher and Second Brain remain valuable existing Micro Apps.
- Agent Inbox is source-neutral and may receive Email, routine failures, repository notifications, or manual notes.
- Work Queue owns actionable Work Items, while Agent Inbox owns triage of incoming context.
- Phase Three Agent Inbox begins with Email signals and manual notes behind a generic incoming-signal contract.
- Triage preserves the incoming signal and creates a separate linked Work Item when action is required.
- Today / Focus Board shows active Work Items, due items, blocked items, recent Artifacts, and failed workflows; it is not a general project-management suite.
- Session Handoff is manually created, with a dedicated Skill available to generate a durable handoff Artifact.
- A Session Handoff includes Repository Context, branch and changed files, Work Items, Artifacts, Skill Runs, decisions, blockers, and next actions.
- Phase Three is complete when the communication-signal-to-handoff workflow works across multiple repositories with provenance and reset/migration coverage; external email-provider integration remains optional.
- Phase Three uses a provider-neutral Email adapter with local/demo signals by default and real provider data only when configured.
- Today / Focus Board exposes applicable actions for Work Items, Skills, Routines, Artifacts, and linked context rather than becoming a second data store.
- Session Handoff begins as an editable draft and becomes an immutable snapshot Artifact when finalized.
- Incoming Signals contain source type, title, body or notes, received/created time, optional source identifier, optional provider, Repository Context, triage status, and links to resulting Work Items, Skill Runs, or Artifacts.
- Integration Incoming Signals use `github` or `vercel` provider provenance and stable provider-event source identifiers. Work Items created from them retain both the signal reference and integration-event reference.
- Phase Three does not send or reply to Email; it supports triage and workflow linking only.
- Phase Three implementation order is Incoming Signal and Agent Inbox, provider-neutral Email/manual-note adapters, triage into linked Work Items, Today / Focus Board, Session Handoff draft/finalization, then Second Brain and browser integration coverage.
- The Phase Three release boundary includes Agent Inbox, demo/manual signals, provider-neutral Email, linked Work Items, Today / Focus Board, Session Handoff, provenance links, multi-repository isolation, and reset/migration coverage.

## Multi-Tenancy Rules (Phase Two+; active hosted architecture)

- The application is multi-tenant SaaS hosted on Vercel + Neon.
- Each organization is a Clerk org mapped 1:1 to a Neon `tenant_id`.
- Every table in Neon has a `tenant_id` column for row-level isolation (no table-per-tenant).
- All API queries must filter by the authenticated user's org's `tenant_id`.
- Developers join organizations via Clerk org invite (email link); app access is separate from GitHub membership.
- Developers must be members of both the Clerk org and the GitHub org to see and work with its repositories.
- Each organization has one Vercel project; all repos in that org deploy to it.
- GitHub data (issues, PRs, actions) is cached in Neon but GitHub remains the source of truth.
- Vercel webhooks (deployment events) are routed to the correct org by looking up the Vercel project ID in the `vercel_projects` table.
- Cross-org data access is not allowed; each org sees only its own artifacts, work items, routines, and connected integrations.
- These rules are reflected in ADR 0001 and ADR 0002 and are the active implementation model for the hosted product.

## Out of Scope

The v2 dashboard does not include a YouTube or audience-metrics widget.
