---
title: Product Scope For The First Build
parent: ../map.md
labels:
  - wayfinder:grilling
status: closed
assignee: GitHub Copilot
blocked_by: []
---

## Question

Which parts of Developer Agentic OS must be fully functional in the first real build, and which can remain visually represented or mocked until later?

Resolve the first-build boundary for Micro Apps, Calendar, Artifacts, Email, Skills Deck, Routines, Second Brain, layout resizing, and settings.

## Resolution Comment

The first build will be a product-grade app with a local-first first milestone. It should be built as a real application, not as a disposable prototype, but the first usable slice must run locally without requiring cloud accounts.

First-build widget boundary:

- Artifacts: real data and persistence.
- Skills Deck: real built-in skill execution for repo summary, branch summary, release readiness, implementation checklist, and sprint digest.
- Routines: real manual run and persisted history; true background scheduling is deferred.
- Second Brain: real graph data for repository files plus artifacts and skills.
- Layout resizing/settings: real behavior with persisted settings.
- Calendar: demo or local-placeholder data in the first build.
- Email: demo or local-placeholder communication signals in the first build.
- Micro Apps: visible and configurable as a product surface, but demo/local-placeholder behavior in the first build unless a micro app maps directly to an implemented core feature.

Integration boundary:

- Local git is mandatory.
- GitHub is optional when a token exists.
- GitLab, Jira, Linear, Slack, email providers, observability tools, Cloudflare Workers, Cloudflare Workflows, and D1 are deferred or shown as available/disconnected states.

Framework direction:

- Use Next.js App Router with TypeScript as the main v2 application framework.
- Use the previous Python app as a behavior-contract reference, not the main runtime.
- Keep Python/FastAPI as an optional future service boundary for workloads that genuinely benefit from Python.
