# Implementation Plan And Validation Strategy

## Goal

Build Developer Agentic OS v2 as a product-grade, local-first Next.js App Router application while preserving the approved visual direction from `index.html` and reusing the previous `D:\repos\Developer-Workflow-OS` app as behavior-contract reference material.

## Approved Decisions

- Main runtime: Next.js App Router with TypeScript.
- First-build APIs: Next.js route handlers.
- Storage: `.developer-agentic-os/` local filesystem store for JSON artifacts, indexes, repo-memory snapshots, skill run records, and routine execution records.
- Client layout preferences: browser `localStorage` for page width, orbit size, widget dimensions, skill-card dimensions, and reset behavior.
- Mandatory integration: local git.
- Integration Operations: GitHub Issues, Pull Requests, Actions, and merge status; Vercel deployments and build/runtime log links.
- Staged integrations: Sentry, Cloudflare, CodeRabbit, WorkOS, Clerk, Convex, NeonDB, Upstash, Email, and Slack expose setup or deferred health states without unsupported actions.
- Built-in skills: `/repo-summary`, `/branch-summary`, `/release-readiness`, `/implementation-checklist`, and `/sprint-digest`.
- Real first-build routines: `nightly_repo_digest`, `weekly_sprint_digest`, and `release_readiness_scan`.
- Second Brain graph: repo, area, file, artifact, and skill nodes with contains, references, produced, and used_context links.
- Out of scope: YouTube, audience metrics, media-performance widgets, Robonuggets branding, drag/reorder, automatic background routine execution, and automatic migration from the previous `.memory` folder.
- User-added micro apps: deferred from first-build persistence. The first build may show a static placeholder micro-app catalog only.

## Implementation Sequence

### 1. Scaffold The Next.js App

Create the real app structure in the repo root using Next.js App Router, TypeScript, ESLint, and a `src/` directory.

Expected files and folders:

- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `src/components/command-centre/*`
- `src/lib/*`
- `src/server/*`
- `src/types/*`
- `tests/*`
- `e2e/*`

Keep the current `index.html` as an approved visual reference until the port is complete.

### 2. Port The Approved Command Centre UI

Turn the static HTML into typed React components while preserving the visual system.

Component targets:

- `CommandCentreShell`
- `MicroAppsPanel`
- `CalendarPanel`
- `ArtifactsPanel`
- `SecondBrainGraph`
- `EmailPanel`
- `SkillsDeck`
- `SkillCard`
- `ModelEffortMatrix`
- `RoutinesPanel`
- `LayoutControls`
- `InspectorPanel`

Requirements:

- Preserve the Developer Agentic OS name.
- Preserve the dark/orange/off-white direction.
- Keep the central orbital graph as the first visual anchor.
- Keep Calendar, Email, and Micro Apps as placeholder widgets.
- Make Artifacts, Skills Deck, Routines, Second Brain, and layout settings live.
- Keep page/orbit/widget/card resizing with content-safe minimums.
- Add Reset layout.
- Avoid horizontal overflow on desktop and mobile.

### 3. Define Shared Types

Create type contracts before implementing storage or UI data loading.

Suggested files:

- `src/types/artifact.ts`
- `src/types/skill.ts`
- `src/types/routine.ts`
- `src/types/integration.ts`
- `src/types/second-brain.ts`
- `src/types/repo-memory.ts`

Key models:

- `Artifact`
- `ArtifactIndexEntry`
- `SkillCommand`
- `SkillRunRecord`
- `RoutineDefinition`
- `RoutineExecutionRecord`
- `IntegrationAdapterStatus`
- `GraphNode`
- `GraphLink`
- `RepoMemorySnapshot`
- `ContextReference`

### 4. Implement The Local Store

Create typed filesystem storage behind server-only modules.

Suggested files:

- `src/server/local-store/paths.ts`
- `src/server/local-store/json-file.ts`
- `src/server/artifacts/artifact-store.ts`
- `src/server/skill-runs/skill-run-store.ts`
- `src/server/routines/routine-history-store.ts`
- `src/server/repo-memory/repo-memory-store.ts`

Storage layout:

```text
.developer-agentic-os/
  artifacts/
    index.json
    <artifact-id>.json
  repo-memory/
    snapshot.json
  skill-runs/
    index.json
    <run-id>.json
  routines/
    definitions.json
    history.json
```

Rules:

- Route handlers and UI components must not write files directly.
- Artifact content may be Markdown text or structured JSON.
- Routine records link artifacts by ID.
- Skill run records may link artifacts by ID.
- Use safe path resolution to prevent path traversal.

### 5. Implement Repo And Git Capabilities

Port behavior from the previous repo memory and git adapter modules into TypeScript.

Reference files from previous app:

- `D:\repos\Developer-Workflow-OS\app\server\repo_memory.py`
- `D:\repos\Developer-Workflow-OS\app\server\repo_graph.py`
- `D:\repos\Developer-Workflow-OS\app\server\adapters\git.py`
- `D:\repos\Developer-Workflow-OS\app\server\release_readiness.py`

Suggested files:

- `src/server/git/git-adapter.ts`
- `src/server/git/local-git-adapter.ts`
- `src/server/repo-memory/index-repo.ts`
- `src/server/repo-memory/feature-context.ts`
- `src/server/release/release-readiness.ts`
- `src/server/release/branch-summary.ts`

First-build behavior:

- Detect current branch.
- Read recent commits.
- Compare branch against base branch.
- List changed files.
- Build repo-memory snapshot.
- Build release-readiness summary.
- Build feature/work-item implementation checklist from manual text.

### 6. Implement Skill Registry And Built-In Skills

Create a `SkillRegistry` that owns the five real first-build skills.

Suggested files:

- `src/server/skills/skill-registry.ts`
- `src/server/skills/built-ins/repo-summary.ts`
- `src/server/skills/built-ins/branch-summary.ts`
- `src/server/skills/built-ins/release-readiness.ts`
- `src/server/skills/built-ins/implementation-checklist.ts`
- `src/server/skills/built-ins/sprint-digest.ts`

Rules:

- A Skill Command is a typed object, not an arbitrary shell command.
- Every skill execution writes a Skill Run Record.
- Successful durable outputs create Artifacts.
- Failed executions write error detail to the Skill Run Record and do not create success artifacts.
- `/branch-summary` requires base and target branch input.
- `/implementation-checklist` requires feature/work-item text.

### 7. Implement Routine Registry And Manual Routine Runs

Create routine definitions and manual execution through route handlers.

Suggested files:

- `src/server/routines/routine-registry.ts`
- `src/server/routines/routine-runner.ts`
- `src/server/routines/default-routines.ts`

First-build routines:

- `nightly_repo_digest`
- `weekly_sprint_digest`
- `release_readiness_scan`

Rules:

- Manual run first.
- Schedule-aware display, no automatic background worker.
- Persist Routine Execution Records.
- Link durable artifacts by ID.
- Support pause/resume per routine.
- Use SkillRegistry handlers where routine behavior overlaps with a skill.

### 8. Implement Integration Adapters

Create the local git, GitHub, and Vercel Integration Operations adapters plus staged provider status entries.

Suggested files:

- `src/server/integrations/integration-registry.ts`
- `src/server/integrations/github-adapter.ts`
- `src/server/integrations/vercel-adapter.ts`
- `src/types/github.ts`
- `src/types/vercel.ts`

Rules:

- Local git is mandatory.
- GitHub uses `GITHUB_TOKEN` or `GH_TOKEN`, derives the repository from the active context's Git remote, and exposes Issues, Pull Requests, Actions, and merge status.
- Vercel uses `VERCEL_TOKEN` or `VERCEL_API_TOKEN`, prefers `.vercel/project.json` from the active context, and exposes deployments plus build/runtime log links.
- Missing credentials and project configuration are `unconfigured`; provider failures are normalized without throwing through the dashboard.
- Staged integrations expose `deferred`, `available`, or setup states with no unsupported action controls.

### 9. Implement Route Handlers

Suggested first-build routes:

- `GET /api/repo/index`
- `POST /api/repo/refresh`
- `GET /api/second-brain/graph`
- `GET /api/artifacts`
- `GET /api/artifacts/[id]`
- `GET /api/skills`
- `POST /api/skills/[id]/run`
- `GET /api/skill-runs`
- `GET /api/routines`
- `POST /api/routines/[id]/run`
- `POST /api/routines/[id]/pause`
- `POST /api/routines/[id]/resume`
- `GET /api/integrations`
- `GET /api/integrations/github`
- `GET /api/integrations/vercel`

### 10. Wire Live Widgets

Live first-build widgets:

- Artifacts reads artifact index and opens artifact detail.
- Skills Deck reads SkillRegistry definitions and latest run state.
- Routines reads routine definitions/history and supports Run Now plus pause/resume.
- Second Brain reads graph data and opens Inspector Panel on node click.
- Layout controls persist and reset local preferences.
- Integration Operations loads provider health on dashboard load, supports manual refresh, and exposes GitHub/Vercel operation summaries.

Placeholder widgets:

- Micro Apps displays static placeholder catalog.
- Calendar displays local/demo agenda.
- Email displays local/demo communication signals.

## Validation Strategy

### Phase Three Boundaries

The Second Brain graph is a projection of persisted relationships, not a discovery engine. Incoming Signals, Work Items, Handoff Artifacts, Skills, Routines, and Repository Contexts are connected only by stored repository IDs, context references, workflow provenance, routine execution records, and finalized handoff artifact IDs. Titles, tags, timestamps, file names, and co-location in a Local Store never create graph edges.

Each repository owns its `.developer-agentic-os/` Local Store. A clean first build initializes missing files and directories without requiring a migration command. `resetLocalStore(root)` removes only that repository's store and recreates its empty directory structure; it must not affect another registered repository's signals, work items, artifacts, routines, or handoffs.

Focused Phase Three checks:

```powershell
npx tsx --test tests/second-brain-graph.test.ts
```

The complete validation commands remain `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:e2e`.

### Unit Tests

Port the previous Python behavior tests as TypeScript unit tests, focusing on contracts rather than line-by-line implementation.

Test targets:

- Artifact store creates, indexes, lists, reads, and safely rejects path traversal.
- Repo memory indexes repo files and builds refreshable snapshots.
- Repo graph produces repo, area, file, artifact, and skill nodes with expected link types.
- SkillRegistry lists built-in skills and rejects unknown IDs.
- Skill runner records queued/running/succeeded/failed states.
- Skill runner creates artifacts only for durable outputs.
- Routine registry lists defaults and stores execution history.
- Routine runner invokes SkillRegistry handlers where applicable.
- Integration registry reports the full provider catalog with explicit connected, unconfigured, deferred, disabled, and error states.
- GitHub and Vercel adapters normalize successful operations and authentication, rate-limit, timeout, unavailable, invalid-response, and unhealthy states.
- Integration failures create deduplicated repository-scoped Incoming Signals; triage can create Work Items with provider-event provenance.

### Route Handler Tests

Test route contracts against temporary directories and fake git adapters where possible.

Coverage targets:

- `/api/repo/index`
- `/api/second-brain/graph`
- `/api/artifacts`
- `/api/skills`
- `/api/skills/[id]/run`
- `/api/routines`
- `/api/routines/[id]/run`
- `/api/integrations`, `/api/integrations/github`, and `/api/integrations/vercel`

### Browser Tests

Use Playwright for approved UI flows.

Smoke flows:

- Dashboard loads as Developer Agentic OS.
- No YouTube or Robonuggets text appears.
- Main layout has Micro Apps, Calendar, Artifacts, Second Brain, Email, Skills Deck, and Routines.
- Skills Deck opens model-by-effort matrix.
- Running a built-in skill transitions status and produces a visible run result.
- Artifacts panel opens an artifact detail.
- Routines panel runs a routine manually and updates history/status.
- Second Brain node click opens Inspector Panel.
- Layout controls resize page/orbit and Reset layout restores baseline.
- Desktop viewport has no horizontal overflow.
- Mobile viewport has no horizontal overflow and vertical-only widget resizing.

### Manual QA

- Start from a clean repo with no `.developer-agentic-os/` folder and verify first-run initialization.
- Run without GitHub or Vercel credentials and verify both appear as unconfigured with setup guidance.
- Run with deterministic GitHub/Vercel fixtures and verify operations, healthy/unhealthy states, and manual refresh.
- Verify Integration Signals are deduplicated, repository-scoped, and triage into linked Work Items.
- Verify two Repository Contexts cannot see each other's operations, signals, or Work Items.
- Run in a non-git folder and verify local git reports a clear error state without breaking the dashboard.
- Delete the Local Store and verify the app recreates required directories/files.

## Suggested Implementation Tickets

1. Scaffold Next.js App Router project and preserve static prototype as visual reference.
2. Port command-centre shell and visual components from `index.html`.
3. Define shared TypeScript domain models.
4. Implement Local Store and artifact storage.
5. Implement repo memory snapshot and local git adapter.
6. Implement Second Brain graph data and inspector interactions.
7. Implement SkillRegistry and five built-in skills.
8. Implement routine registry, manual run, pause/resume, and history.
9. Implement Integration Operations registry with local git, GitHub, Vercel, and staged provider states.
10. Add provider failure signals and Work Item provenance.
11. Wire live dashboard widgets to route handlers.
12. Add unit and route handler tests for core contracts.
13. Add Playwright smoke tests for approved UI and cross-repository operations flows.
14. Update README with Next.js setup, run commands, and current integration boundaries.

## Handoff Verdict

The first build, Phase Two, Phase Three, and the Integration Operations MVP are implemented and validated. The completed Integration Operations issue is 26 with child tickets 27–31. The Wayfinder map and implementation issues remain as decision and traceability records; future work should begin with a new spec and issue set rather than treating this handoff as an unfinished implementation plan.
