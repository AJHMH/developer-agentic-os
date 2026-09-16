---
title: Build Developer Agentic OS From Approved Design And Previous Repo
labels:
  - wayfinder:map
status: closed
---

## Destination

Reach an implementation-ready route for building Developer Agentic OS v2: a working application that keeps the approved command-centre design while reusing or adapting the previous `D:\repos\Developer-Workflow-OS` backend concepts, tests, and docs where they still fit.

The map is complete when the remaining work can be handed off as implementation tasks with no unresolved product, architecture, data, integration, or validation decisions blocking the build.

## Notes

- Use the approved visual baseline in `index.html`: Developer Agentic OS name, dark command-centre layout, central orbital Second Brain, left Micro Apps/Calendar/Artifacts rail, right Email/Skills Deck/Routines rail, no YouTube widget, no Robonuggets references, and in-page resizing.
- Consult the `grilling` and `domain-modeling` skills while resolving HITL decision tickets.
- Treat `CONTEXT.md` as the domain glossary, not an implementation spec.
- Source references include current v2 docs and the previous repository at `D:\repos\Developer-Workflow-OS`.
- Planning-first: do not implement the application from this map until the frontier decisions are resolved.

## Decisions so far

<!-- Closed tickets are indexed here with one-line gists. Decision detail lives in the ticket resolution. -->

- [Previous Backend Reuse Inventory](tickets/previous-backend-reuse-inventory.md): Reuse the previous app's backend contracts, modules, tests, and docs as reference material, but do not treat Python/Flask, Cloudflare, or the old dashboard as mandatory v2 runtime choices.
- [Product Scope For The First Build](tickets/product-scope-for-first-build.md): Build a product-grade, local-first first milestone with real artifacts, built-in skill execution, manual routines/history, Second Brain repo/artifact/skill graph, layout settings, local git, optional GitHub, and placeholder Calendar/Email/Micro App data.
- [Runtime Architecture And Stack Choice](tickets/runtime-architecture-and-stack-choice.md): Use Next.js App Router with TypeScript as the main runtime, Next.js route handlers for first-build APIs, filesystem-backed local persistence, and the previous Python app as reference-only behavior contracts.
- [Artifact And Memory Storage Contract](tickets/artifact-and-memory-storage-contract.md): Store first-build local state under `.developer-agentic-os/` with JSON artifacts plus indexes, refreshable repo-memory snapshots, JSON run/routine records, artifact ID links, and client-owned layout settings in `localStorage`.
- [Skills Deck Execution Contract](tickets/skills-deck-execution-contract.md): Ship five real built-in skill commands behind typed `SkillRegistry` handlers, persist default model/effort settings, record every run, create artifacts only for durable outputs, and keep user-added/non-core skills as placeholders.
- [Routines Scheduling Contract](tickets/routines-scheduling-contract.md): Ship manual first-build routines with schedule-aware display, run history, pause/resume, three real routines, placeholder cleanup/stale-branch routines, and SkillRegistry-backed behavior where possible.
- [Integration Boundary For The First Build](tickets/integration-boundary-for-first-build.md): Require local git, enable GitHub PR/branch metadata when token credentials exist, render all other integrations as available/deferred, and represent integrations through typed status/capability adapters.
- [Resizable Command Centre Behavior](tickets/resizable-command-centre-behavior.md): Persist page, orbit, widget, and skill-card sizing in `localStorage`, ship content-safe resize bounds plus Reset layout, keep mobile vertical-only, and defer drag/reorder.
- [Second Brain Data Model](tickets/second-brain-data-model.md): Model the first-build graph as repo, area, file, artifact, and skill nodes with contains, references, produced, and used_context links from a refreshable Repo Memory Snapshot.
- [Implementation Plan And Validation Strategy](tickets/implementation-plan-and-validation-strategy.md): Final handoff lives in `docs/implementation-plan-and-validation-strategy.md`, with ordered build tickets, module targets, route contracts, test strategy, browser checks, and user-added micro app persistence deferred.

## Not yet specified

No remaining fog for this map.

## Out of scope

- YouTube, audience metrics, subscriber counts, or media-performance widgets are out of scope for this effort.
- Robonuggets branding is out of scope for this effort.
- Persisted user-added micro apps are out of scope for the first build; the first build may show a static placeholder micro-app catalog.
