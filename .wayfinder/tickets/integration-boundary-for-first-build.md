---
title: Integration Boundary For The First Build
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

Which external integrations are in the first build boundary, and what are their fallback states when credentials are absent?

Decide the first-build treatment for local git, GitHub/GitLab, Jira/Linear, Slack/email, observability adapters, and Cloudflare edge sync.

## Resolution Comment

Developer Agentic OS v2 will ship a narrow first-build integration boundary focused on local repository value.

Integration decisions:

- Mandatory integration: local git.
- Optional first-build integration: GitHub, enabled when `GITHUB_TOKEN` or `GH_TOKEN` exists.
- First GitHub capability: PR and branch metadata. Issues, Releases, Actions/CI, and full repo sync are deferred.
- Disconnected integrations: render as `available`, not broken. Missing credentials should show setup-ready status and guidance without error noise.
- Issue trackers: Jira, Linear, and GitHub Issues are available/deferred. `/implementation-checklist` accepts manual work item text instead of requiring issue sync.
- Email and Slack: Email remains a placeholder communication-signal widget. Slack remains an available future integration for routine notifications.
- Cloudflare: Workers, Workflows, D1, and edge sync are deferred. The first build is local-first with filesystem storage.
- Observability: Datadog, Sentry, PagerDuty, New Relic, and similar tools are available/deferred, not first-build requirements.
- Integration code shape: use typed integration adapters exposing `id`, `name`, `kind`, `status`, `capabilities`, and optional setup guidance.

This makes disconnected integrations part of product behavior rather than exceptions.
