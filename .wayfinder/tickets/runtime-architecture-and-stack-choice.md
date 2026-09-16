---
title: Runtime Architecture And Stack Choice
parent: ../map.md
labels:
  - wayfinder:grilling
status: closed
assignee: GitHub Copilot
blocked_by:
  - tickets/product-scope-for-first-build.md
  - tickets/previous-backend-reuse-inventory.md
---

## Question

What runtime architecture should Developer Agentic OS v2 use for the real build?

Decide whether to keep a static-first frontend with a Python/Flask local API, move to a modern frontend app with a separate API, package the previous backend directly, or choose another structure. The answer must account for local development, future integrations, and testability.

## Resolution Comment

Developer Agentic OS v2 will use Next.js App Router with TypeScript as the main application runtime.

Runtime decisions:

- Main app runtime: Next.js App Router with TypeScript.
- Python role: reference-only for the first build. The previous Python app supplies behavior contracts, module boundaries, and tests to port or adapt.
- Future Python service boundary: allowed later through FastAPI if a specific workload needs Python, async APIs, or heavy repo analysis.
- API boundary: first-build APIs live in Next.js route handlers.
- Persistence boundary: filesystem-backed local JSON/Markdown first, with SQLite deferred until the data model stabilizes.
- Deployment target: local-first, deployable by design. The app should run locally without hosted auth, hosted database, Cloudflare, or Vercel setup, while staying compatible with later deployment.
- Test strategy: unit tests for ported behavior contracts plus Playwright smoke tests for approved dashboard flows.

The approved static `index.html` remains the visual source of truth during the port into typed Next.js components.
