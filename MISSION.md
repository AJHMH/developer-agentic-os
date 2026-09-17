# Mission: Hosted and Local Application Modes

## Why

I want to understand how this application behaves in hosted versus local mode so I can navigate the codebase confidently, explain request flow, and make changes without confusing the two runtime paths.

## Success looks like

- I can explain which UI entry point each mode renders and why.
- I can trace one request through authentication, workspace context, and persistence in each mode.
- I can predict which files and tests are relevant when a mode-specific behavior breaks.

## Constraints

- Start with a short, concrete architecture lesson tied to the current repository.
- Prefer retrieval and code-tracing exercises over broad framework theory.

## Out of scope

- Deep Clerk, Neon, GitHub, or Vercel implementation details until the mode boundary is clear.
- A complete inventory of every feature in the application.
