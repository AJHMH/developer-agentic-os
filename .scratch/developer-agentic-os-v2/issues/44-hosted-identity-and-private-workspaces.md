# 44: Hosted Identity And Private Workspaces

**What to build:** A developer can authenticate through a provider-neutral boundary, create multiple private Workspaces, switch between them, and receive clear unauthenticated or cross-Workspace access errors.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] Authentication is exposed through a provider-neutral application boundary.
- [x] Unauthenticated requests are rejected without leaking private data.
- [x] A user can create, list, select, and isolate multiple private Workspaces.
- [x] Cross-user and cross-Workspace access is rejected.
- [x] Identity and Workspace actions are recorded for audit.
- [x] Unit, route, and browser tests cover identity and private Workspace behavior.

## Completion

Implemented with deterministic non-production authentication fixtures and
provider-neutral token verification boundaries. Production Clerk configuration
remains part of the open hosted release work.

## Execution Notes

- Verified existing local ownership seam: `WorkspaceStore` persists repository contexts in `.developer-agentic-os/workspace.json`, and `/api/workspace/*` routes use that local-first singleton.
- Hosted mode will be separate: a provider-neutral request adapter will resolve an explicit deterministic identity from `x-hosted-user-id`; hosted workspaces and audit events will use a distinct store file and routes.
- Planned focused coverage: adapter authentication/rejection, multiple workspace creation/list/select, cross-user and cross-workspace isolation, unauthenticated route rejection, and audit history.
- Validation: `npm run test -- tests/hosted-identity.test.ts` and `npm run typecheck`.
