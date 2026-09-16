---
title: Skills Deck Execution Contract
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

How should a Skills Deck card behave when the user runs or configures it?

Resolve the command model, model-by-effort settings, execution states, output artifact format, failure behavior, and how much of the previous skill runner should be reused.

## Resolution Comment

Developer Agentic OS v2 will ship a small real built-in Skills Deck for the first build, while keeping user-added and non-core skills as configurable placeholders.

Skills Deck decisions:

- Built-in real skills: `/repo-summary`, `/branch-summary`, `/release-readiness`, `/implementation-checklist`, and `/sprint-digest`.
- Placeholder skills: `/newsletter`, `/games`, `/clean-up`, and custom user-added skills until the core developer workflow is stable.
- Skill command model: a typed object with `id`, `label`, `description`, `model`, `effort`, `inputs`, `status`, and `handler`. The slash-command string is display syntax, not the full model.
- Run behavior: pressing run creates a Skill Run Record, transitions the card through `queued -> running -> succeeded/failed`, and creates an Artifact only when the skill produces durable output.
- Configuration behavior: the model-by-effort matrix edits the skill's default model and effort for future runs.
- Settings persistence: built-in skill settings persist in the Local Store. Purely visual preferences may stay in browser `localStorage`.
- Input collection: `/branch-summary` prompts for base and target branch; `/implementation-checklist` prompts for feature/work item text; other first-build skills run from current repo context with optional notes.
- Failure behavior: failed runs create Skill Run Records with error detail, show compact failure state in the UI, and support retry with the same settings. Failed runs do not create success artifacts.
- Previous app reuse: reuse behavior and test expectations from the previous Python modules, but port the five core skill contracts into TypeScript behind a `SkillRegistry`.
