# Phase Two / Phase Three Agent Brief

## Scope

This is an internal execution brief for the next agent pass. It is intentionally not a user-facing status document.

Goal: continue the deferred work implied by the local-first Phase Two and Phase Three plan in README, without rehashing the already-completed local implementation status.

## Current repo state

- The repo is green on the project gates.
- Local-first Phase Two and Phase Three work is already represented in the code and issue docs.
- The README still explicitly defers hosted/cloud/shared-workspace work beyond the local-first scope.
- Therefore, the next implementation pass should target the deferred hosted follow-up items, not duplicate completed local features.

## Source references

- README local-first scope and deferred items: ../README.md#L72-L84
- Phase Two issue set: ../.scratch/developer-agentic-os-v2/issues/14-19
- Phase Three issue set: ../.scratch/developer-agentic-os-v2/issues/20-25
- Current repo quality gates: ../.github/workflows/ci.yml

## What is already done locally

These items are already in the repo and should be treated as completed if the agent is not asked to rebuild them:

- workspace and repository context registration
- workspace switcher and repository selection
- work queue and work items
- repository-aware workflow execution
- local background routine executor with leases and pause exclusion
- second brain graph integration for repo/file/artifact/skill/routine/work-item relationships
- incoming signal and agent inbox
- triage actions into work items/skills/artifacts
- focus board aggregation
- handoff draft and finalization
- provider-neutral email adapter in read-only demo mode

## Deferred items to tackle next

The next implementation pass should treat the following as the real open work, because they are outside the current local-first repo scope and are the likely next product expansion frontier:

1. Hosted / shared workspace model
   - cross-user shared workspace state
   - tenant-aware organization membership and access boundaries
   - persistent hosted workspace selection

2. Hosted auth and identity integration
   - Clerk-backed org membership and repo-scoping in hosted mode
   - real user/session identity plumbing for hosted operations

3. Hosted scheduling and automation
   - durable external background execution
   - shared routine scheduler with cross-process coordination
   - approval workflows for automated actions

4. Cloud synchronization and tenant-scoped persistence
   - Neon-backed state and multi-tenant repository scoping
   - shared repository snapshot and operational event persistence

5. Real external provider integrations
   - GitHub, Vercel, Sentry, etc. beyond the local/demo read-only surfaces
   - provider-safe normalization and retrieval pipelines

6. Hosted export, migration, and backup flow
   - deterministic exports and imports for tenant-owned data
   - audit trail and restoration paths

7. Persistent user-added micro-apps
   - actual saved micro-app catalog and per-user configuration

## Proposed implementation order

1. Hosted identity + workspace model
2. Hosted repository scoping and tenant boundaries
3. Hosted persistence and migration contract
4. Hosted background automation and scheduler
5. Real provider integrations
6. Hosted UX polish and operational surfaces
7. Export/restore and safety flows

## Constraints

- Do not duplicate completed local-first functionality.
- Do not rework the existing local game plan unless a new hosted requirement reveals a mismatch.
- Keep the local-first repo stable while the hosted scope is added.
- Prefer clear boundaries between local-first and hosted modules.
- Preserve the existing issue structure and documentation trail.
- Use the repo’s current TypeScript, route, and local-store conventions.

## Validation commands

Use the existing repo gates:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

If the hosted work adds new routes or workflows, add the smallest targeted tests first before implementing the feature.

## Execution note for the next agent

This is not a cleanup task. It is a deliberate extension of the product into the deferred hosted architecture.

The agent should:

- confirm the target hosted slice before coding
- read the existing hosted patterns in the repo first
- add failing tests for each new hosted boundary
- implement the minimal production fix
- validate with the repo gates

## Expected result after implementation

A repo that preserves the completed local-first Phase Two and Phase Three foundation while adding the deferred hosted architecture described in the README, without regressing the current local product.
