# Hosted Personal Developer OS

## Problem Statement

Developer Agentic OS is currently local-first. Its Repository Contexts,
Artifacts, Work Items, Incoming Signals, Automation Runs, approvals, and audit
records live on one developer machine, while provider credentials are supplied
through local environment variables. This makes the system difficult to use
across machines and prevents hosted automation from continuing when the local
application is closed.

The developer needs a private hosted workspace that preserves the local
workflow model while safely connecting to local repositories. Hosted state must
be durable and queryable, local filesystem state must remain truthful, and
credentials or provider mutations must never be exposed through an unsafe or
stale connector.

## Solution

Build a personal-first hosted OS with multiple private Workspaces per user.
Use managed-provider-independent authentication, initially backed by Clerk,
and deploy the Next.js application on Vercel. Use Postgres for indexed domain
state and object storage for large Artifact content.

Hosted state owns the account, Workspaces, approvals, and audit records. Local
connectors retain ownership of filesystem-derived Repository Context state and
publish it one way to the hosted OS. An outbound authenticated connector may
serve multiple repositories through explicit repository and capability grants.

Hosted-safe automation continues while a connector is offline; local-repository
work becomes visibly pending. Historical local state may inform diagnosis but
never authorizes a provider mutation. Migration begins with a reviewable export
package and selected import, followed by reliable export and backup rather than
bidirectional synchronization.

## User Stories

1. As a developer, I want to sign in securely, so that my OS is private to me.
2. As a developer, I want multiple private Workspaces, so that personal,
   client, and experimental repositories remain organized.
3. As a developer, I want each Workspace isolated, so that records cannot leak
   between private areas.
4. As a developer, I want authentication behind a provider-neutral boundary,
   so that the product is not permanently coupled to one auth vendor.
5. As a developer, I want hosted state to survive machine changes, so that my
   workflow is available wherever I sign in.
6. As a developer, I want indexed domain state in a transactional store, so
   that provenance, approvals, and audit queries remain reliable.
7. As a developer, I want large Artifact content stored separately, so that
   durable documents do not burden indexed operational state.
8. As a developer, I want to connect a local Repository Context, so that
   hosted workflows can use truthful branch and filesystem information.
9. As a developer, I want the connector to make outbound connections only, so
   that the hosted service never opens an inbound path to my machine.
10. As a developer, I want to revoke a connector immediately, so that lost or
    compromised local access can be stopped.
11. As a developer, I want one connector to serve multiple repositories, so
    that setup does not multiply unnecessarily.
12. As a developer, I want explicit repository grants, so that a connector
    cannot access every repository by default.
13. As a developer, I want Git metadata available by default, so that hosted
    views can show branch, commit, diff, and repository status.
14. As a developer, I want filesystem access granted per Skill, so that a Skill
    cannot read or modify files outside its approved capability.
15. As a developer, I want connector actions auditable, so that I can see what
    repository and capability each request used.
16. As a developer, I want hosted-safe workflows to continue when my connector
    is offline, so that provider monitoring and hosted Work Items remain useful.
17. As a developer, I want local-repository workflows marked pending offline,
    so that stale local state is never presented as current.
18. As a developer, I want the connector to resume pending work safely, so that
    short outages do not lose workflow intent.
19. As a developer, I want stale local state available for diagnosis, so that
    historical context remains useful.
20. As a developer, I want stale local state blocked from authorizing provider
    mutations, so that old evidence cannot trigger current external changes.
21. As a developer, I want provider credentials isolated from repository data,
    so that secrets are not included in Workspace records or status payloads.
22. As a developer, I want OAuth used where supported, so that access can be
    granted and revoked without copying long-lived tokens unnecessarily.
23. As a developer, I want non-OAuth credentials protected by managed secrets
    or encryption, so that provider access is not stored in browser state.
24. As a developer, I want provider scopes visible without exposing secrets,
    so that I understand what each connection can do.
25. As a developer, I want a reviewable export before migration, so that I can
    inspect sensitive and legacy content before upload.
26. As a developer, I want to select repositories and records for import, so
    that migration is deliberate rather than all-or-nothing.
27. As a developer, I want path-based local IDs mapped to hosted identities,
    so that moving a repository does not create accidental duplicate history.
28. As a developer, I want legacy records handled explicitly, so that missing
    repository provenance is visible rather than silently guessed.
29. As a developer, I want hosted data export and backup, so that I can leave
    or recover without depending on one provider.
30. As a developer, I want local-derived state published one way, so that
    synchronization conflicts do not corrupt the system of record.
31. As a developer, I want hosted-owned Work Items, Signals, approvals, and
    audit records changed through hosted APIs, so that ownership is clear.
32. As a developer, I want local Repository Memory snapshots published with
    freshness metadata, so that I can tell current from historical context.
33. As a developer, I want hosted automation to retain approval and audit
    semantics, so that moving execution to the cloud does not reduce trust.
34. As a developer, I want local connector requests scoped to a Workspace, so
    that one account cannot accidentally cross private boundaries.
35. As a developer, I want connector and Workspace events retained, so that
    access changes and revocations are attributable.
36. As a developer, I want the current local command centre preserved during
    migration, so that hosted work is an extension rather than a replacement.
37. As a future team user, I want the model to support permissions later, so
    that personal-first architecture does not block collaboration.

## Implementation Decisions

- The highest test seam is the hosted/local ownership boundary: authenticate a
  user, authorize a Workspace and connector capability, read or publish a
  Repository Context snapshot, and verify ownership, freshness, revocation,
  and audit behavior.
- The first hosted product is personal-first and supports multiple private
  Workspaces per user. Shared team Workspaces, invitations, and permissions
  are future-compatible but not required for the first release.
- Authentication uses a provider-neutral application boundary with Clerk as
  the initial managed provider. Auth provider details must not leak into domain
  records or route contracts.
- The hosted web runtime is Next.js App Router deployed on Vercel. A separate
  worker is introduced only for workloads that cannot run reliably in the web
  runtime.
- Postgres stores indexed hosted domain state: users, Workspaces, Repository
  Context registrations, Work Items, Signals, Incidents, Automation Runs,
  approvals, and audit records. Object storage stores large Artifact bodies
  and export packages.
- Hosted state owns account identity, Workspace membership, approvals, and
  audit. The local connector owns filesystem-derived state and never treats
  hosted records as local filesystem truth.
- One outbound connector may serve multiple repositories, but every request
  requires an explicit Workspace, Repository Context, and capability grant.
- Git metadata is the default connector capability. Filesystem access is
  allowlisted and granted per Skill; full unrestricted repository access is not
  a first-release capability.
- Connector credentials are short-lived where possible, revocable, never
  placed in browser state, and never returned in status or repository payloads.
- Provider credentials use OAuth where supported. Other credentials use a
  managed secrets boundary or authenticated encryption; the database stores
  references and metadata rather than plaintext secrets.
- Local-derived state publishes one way to hosted state. Hosted-owned records
  are changed through hosted APIs. Bidirectional conflict reconciliation is
  explicitly deferred.
- Migration starts with a reviewable export package and selected import. The
  import process maps path-derived Repository Context IDs to explicit hosted
  identities and reports records with missing provenance.
- Export and backup are first-class hosted operations and must include enough
  metadata to restore relationships and provenance.
- When the connector is offline, hosted-safe workflows continue and
  local-repository workflows enter a visible pending state. Stale snapshots
  may inform diagnosis but cannot authorize provider mutations.
- Hosted automation preserves approval-gated provider actions, immutable audit
  evidence, and the operational lifecycle established by the completed local
  phase.
- The local command centre remains usable during migration. Hosted and local
  surfaces share domain vocabulary but do not silently share storage.
- The data model must leave a clear extension point for future team roles and
  permissions without making them first-release dependencies.

## Testing Decisions

- Tests assert behavior at the hosted/local ownership boundary, not auth SDK
  calls, ORM internals, SQL formatting, or storage-provider implementation.
- Authentication tests use a deterministic provider adapter and verify signed
  identity, unauthenticated access rejection, session expiry, and Workspace
  isolation.
- Workspace and authorization tests verify private Workspace creation,
  selection, repository grants, capability grants, revocation, and cross-user
  rejection.
- Persistence tests verify transactional relationships, Artifact object
  storage references, audit immutability, and failure recovery.
- Connector tests use a deterministic local connector fixture to verify
  outbound registration, scoped Git access, per-Skill filesystem grants,
  revocation, expiry, replay rejection, and audit records.
- Migration tests verify export inspection, selected import, path changes,
  legacy records without provenance, duplicate prevention, relationship
  preservation, and safe retry.
- Offline tests verify hosted-safe continuation, pending local workflows,
  freshness labeling, connector reconnection, and stale-state mutation denial.
- Hosted automation tests reuse the operational orchestration seam and verify
  approval, audit, provider action, and Workspace isolation.
- Browser tests cover sign-in, private Workspace switching, connector setup,
  capability grants, offline pending state, migration review/import, export,
  and audit inspection using deterministic fixtures.
- Existing unit, route, and Playwright tests remain regression coverage for the
  local command centre and operational automation.

## Out Of Scope

- Shared team Workspaces, invitations, roles, permissions, billing, and
  multi-tenant collaboration in the first hosted release.
- Bidirectional local/hosted synchronization and automatic conflict merging.
- Inbound tunnels, unrestricted local filesystem access, or arbitrary remote
  shell execution.
- Stale local state authorizing provider mutations.
- Plaintext credentials in Postgres, browser storage, Workspace records, or
  status payloads.
- Full provider-specific dashboards or replacing GitHub, Vercel, Sentry, or
  local Git as systems of record.
- Automatic migration from the old Python `.memory` directory without review.
- Fully autonomous consequential provider actions.

## Further Notes

- This phase follows the completed Operational Automation And Incident
  Response phase and is the first hosted boundary for the Agentic OS.
- The initial hosted release gate is end-to-end: sign in, create a private
  Workspace, import selected local data, connect a scoped local repository,
  run a read-only Skill, survive connector offline state, and inspect the
  resulting audit trail.
- Trust is a release gate. Connector grants must be revocable, provider
  mutations require current connector evidence and approval, and hosted audit
  records must be immutable.
