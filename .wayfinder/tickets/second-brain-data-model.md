---
title: Second Brain Data Model
parent: ../map.md
labels:
  - wayfinder:grilling
status: closed
assignee: GitHub Copilot
blocked_by:
  - tickets/product-scope-for-first-build.md
  - tickets/previous-backend-reuse-inventory.md
  - tickets/artifact-and-memory-storage-contract.md
---

## Question

What data should the central Second Brain graph represent in the first build?

Decide whether it shows repo files, work items, skills, routines, integrations, artifacts, or all of them, and define the node/link contract needed by the UI.

## Resolution Comment

Developer Agentic OS v2 will ship a focused first-build Second Brain graph centered on repo memory and produced work.

Second Brain decisions:

- Graph scope: repo files, artifacts, and skills.
- Deferred graph scope: routines, integrations, people, external issue objects, and live email/calendar objects remain out of the first-build graph.
- Node types: `repo`, `area`, `file`, `artifact`, and `skill`.
- Link types: `contains`, `references`, `produced`, and `used_context`.
- Data source: the graph is generated from a refreshable Repo Memory Snapshot rather than recomputed from scratch on every UI read.
- Artifact relationships: artifacts link to repo files or areas through explicit `contextRefs` recorded by skill outputs.
- Skill relationships: each built-in skill appears as a skill node, links to artifacts it produced, and may link to repo areas it commonly reads.
- Interaction model: clicking a graph node opens an inspector panel. File nodes show path/type, artifact nodes show metadata and an open-artifact action, and skill nodes show latest run status plus run/configure actions.

The graph should preserve the approved orbital visual design while grounding its data in typed nodes and links.
