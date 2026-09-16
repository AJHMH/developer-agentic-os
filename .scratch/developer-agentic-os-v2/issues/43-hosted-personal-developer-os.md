# 43: Hosted Personal Developer OS

**Triage:** ready-for-agent

**What to build:** Extend Developer Agentic OS from a local-first application into a private hosted personal OS with managed authentication, durable hosted state, reviewable migration, and a scoped outbound local connector.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A user can authenticate through a provider-neutral application boundary.
- [ ] A user can create and switch between multiple private Workspaces.
- [ ] Hosted state stores indexed domain records transactionally and stores large Artifact content separately.
- [ ] A user can export local data for review and import selected repositories and records.
- [ ] A local connector can register outbound, be revoked, and serve multiple repositories through explicit grants.
- [ ] Git metadata is available by default and filesystem access is capability-scoped per Skill.
- [ ] Hosted-safe workflows continue while the connector is offline; local workflows show pending and freshness state.
- [ ] Stale local state cannot authorize provider mutations.
- [ ] Hosted approvals, provider actions, and audit records preserve the completed operational trust model.
- [ ] Two private Workspaces and two Repository Contexts remain isolated.
- [ ] Existing local command-centre and operational automation behavior remains green.
- [ ] Full migration, connector, offline, authorization, audit, browser, and regression coverage passes.

## Testing Seam

The primary seam is the hosted/local ownership boundary: authenticate a user,
authorize a Workspace and connector capability, read or publish a Repository
Context snapshot, and verify ownership, freshness, revocation, and audit
behavior. Tests should assert resulting records and user-visible behavior, not
auth SDK calls, ORM internals, or storage-provider implementation.

## Source Specification

See [spec-hosted-personal-developer-os.md](../../../spec-hosted-personal-developer-os.md).

## Progress Record

- Hardened fixture authentication so production cannot accept fixture headers; the token boundary now reports when no verifier is configured.
- Kept the hosted JSON implementation explicitly deterministic and fixture-only. Production requires an injected transactional `HostedStateProvider`; no Clerk, Postgres, Vercel, or object-storage integration is claimed here.
- Added persisted Automation Run approval gating bound to the current connector snapshot and provider action, with audit evidence for provider mutations; selective repository migration with relationship remapping and hard rejection of unmapped provenance; canonical filesystem allowlists with repository-root containment; typed hosted error status mapping; and artifact object references/metadata backed by `LocalHostedObjectStore`.
- Added hosted connector-status, repository-grant, and capability-grant views, deterministic read-only Skill execution records, route coverage, and browser coverage. Fixture-only JSON remains explicitly rejected in production; no real Clerk, Postgres, Vercel, managed secret, or production object-storage integration is claimed.
- Hosted regression coverage passes locally: focused hosted tests, full `npm test`, `npm run lint`, and `npm run typecheck`. Remaining gaps are the real provider implementations, deployment wiring, and transactional/managed-storage semantics behind the injected interfaces. Hosted settings UI and full hosted CRUD remain explicit deferred boundaries and are not implemented here.
- Final hosted review hardening: malformed/null route bodies and action fields are rejected with 400; scoped repository, record, snapshot, connector, credential, and audit views are available; offline/reconnect/resume actions are covered; credential secrets are delegated to an injected ProtectedSecretStore; and filesystem checks use realpath when paths exist. Fixture JSON, deterministic secrets, and local object storage remain explicitly non-production implementations.
