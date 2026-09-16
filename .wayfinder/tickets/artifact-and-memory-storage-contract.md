---
title: Artifact And Memory Storage Contract
parent: ../map.md
labels:
  - wayfinder:grilling
status: closed
assignee: GitHub Copilot
blocked_by:
  - tickets/product-scope-for-first-build.md
  - tickets/runtime-architecture-and-stack-choice.md
---

## Question

What is the storage contract for artifacts, repo memory, widget layout state, skill runs, and routine history?

Decide the first-build persistence layer, file formats, ownership boundaries, and what must migrate from the previous `.memory` and artifact-store concepts.

## Resolution Comment

Developer Agentic OS v2 will use a local, inspectable filesystem storage contract for the first build.

Storage decisions:

- Storage root: `.developer-agentic-os/` by default, with configurability deferred until a real need appears.
- Artifact format: one JSON file per artifact, plus an artifact index file. Artifact content may be Markdown text or structured JSON.
- Repo memory format: JSON snapshots on disk, refreshable on demand.
- Layout settings: persist client-only layout preferences in browser `localStorage` for the first build.
- Skill run records: every skill execution writes a structured run record; executions that produce durable output also create an artifact.
- Routine history: store structured JSON execution records and link produced artifacts by ID instead of duplicating artifact content.
- Previous app migration: no automatic migration from the previous `.memory` folder in the first build. Use previous schemas as reference material only; add explicit import later if needed.

Ownership boundary:

- Filesystem-backed storage belongs behind typed storage modules in the Next.js app, not scattered through route handlers or UI components.
- Browser-only layout preferences remain client-owned unless they need cross-browser or cross-machine sync.
