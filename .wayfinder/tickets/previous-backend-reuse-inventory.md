---
title: Previous Backend Reuse Inventory
parent: ../map.md
labels:
  - wayfinder:research
status: closed
assignee: GitHub Copilot
blocked_by: []
---

## Question

Which modules, endpoints, tests, and docs from `D:\repos\Developer-Workflow-OS` are still reusable for Developer Agentic OS v2, and which are stale because the product direction has changed?

The answer should identify concrete source files, reusable behaviors, incompatible assumptions, and migration risks.

## Resolution Comment

The previous Python application should be treated as reusable product and backend reference material, not as a runtime mandate. The strongest reuse candidates are the deep backend modules and their behavior contracts:

- `app/server/api.py`: endpoint shape for repo index, feature context, branch summary, release readiness, artifacts, routines, and graph data.
- `app/server/command_centre.py`: artifact storage, navigation, routine run logging, and filesystem-backed memory seam.
- `app/server/repo_memory.py`: repo indexing, feature-context mapping, issue-to-code mapping, and checklist generation.
- `app/server/repo_graph.py`: node/link contract for the Second Brain graph.
- `app/server/routine_scheduler.py`: routine registration, due-routine execution, and routine-result artifact persistence.
- `app/server/adapters/git.py`: source-control adapter seam, including subprocess and fake adapters.
- `app/server/events/registry.py` and `app/server/events/security.py`: event registry and webhook signature seam.
- Skill modules such as `branch_summary.py`, `release_readiness.py`, `release_notes.py`, `weekly_digest.py`, `sprint_recap.py`, `implementation_checklist.py`, and `issue_mapping.py`.
- Tests under `tests/`, especially API, repo memory, repo graph, routine scheduler, artifact navigation, git adapter, release readiness, and event ingestion tests.

Do not carry forward these assumptions unchanged:

- The old UI and dashboard HTML are superseded by the approved Developer Agentic OS design.
- YouTube, audience metrics, Robonuggets branding, and media-performance widgets remain out of scope.
- Docs claiming FastAPI conflict with the previous Flask implementation; v2 should pick one runtime explicitly.
- Cloudflare Workers, Workflows, D1, and serverless fallbacks are optional later integration choices, not first-build defaults.
- Webhook HMAC verification must not silently pass when a secret is missing outside explicit local/test mode.
- Hardcoded provider/model defaults should become configurable skill settings.

Framework recommendation for the next decision: build v2 as a TypeScript frontend application and preserve the previous backend's contracts as portable module boundaries. A strong default is Next.js/App Router if a full product shell, typed API routes, and future hosted deployment matter; otherwise Vite + React with a small FastAPI/Flask local API is simpler. The runtime architecture ticket should decide between those based on first-build scope.
