## Issue 14: Workspace And Repository Context

- Implemented typed `Workspace` and `RepositoryContext` models.
- Added `.developer-agentic-os/workspace.json` persistence with stable SHA-256 IDs derived from resolved local paths.
- Added repository registration, listing, removal, active-context selection, path validation, and cwd fallback behavior.
- Added `GET/POST /api/workspace/repositories`, `DELETE /api/workspace/repositories/:id`, and `GET/PUT/POST /api/workspace/context`.
- Added focused unit and route coverage in `tests/workspace-context.test.ts`.
- Validation: focused tests pass (4/4), full tests pass (24/24), `npm run typecheck` passes, and `npm run lint` passes with zero warnings.
- Scope note: existing consumers continue to default to `process.cwd()`; repository-aware propagation is deferred to tickets 15-19 as requested.

## Issue 24: Provider-Neutral Email Adapter

- Added typed read-only Email adapter boundary with local demo signals by default.
- Added configured provider JSON mapping through `EMAIL_PROVIDER` and `EMAIL_PROVIDER_DATA`; `EMAIL_ENABLED=false` disables ingestion.
- Wired Email status into the existing Integration Adapter vocabulary and added `GET /api/email` sync route.
- Preserved Inbox persistence, filtering, triage, and action behavior; adapter exposes no send, reply, delete, or full-client operations.
- Validation: focused adapter tests 5/5, full unit/route tests 48/48, typecheck, lint, production build, and focused Email browser tests 2/2 passed.
- Caveat: the full Playwright suite has two existing workspace-switcher reload assertion failures in both projects; the new Email test passes in desktop and mobile.
