# Unified Command Centre & Core Experience Consolidation

## Problem Statement

Developer Agentic OS has reached an architectural crossroad characterized by three visible symptoms:

1. **Dual Frontend Disparity**: In `src/app/page.tsx`, an environment switch (`process.env.VERCEL === "1"`) forks the application into two completely separate user interfaces: a 470-line basic SaaS stub (`HostedCommandCentre`) and a 2,893-line rich cyberpunk command centre (`CommandCentreShell`). Users deploying or testing hosted mode lose 85% of the application features (micro-apps, orbital constellation, artifacts tray, triage, and signals).
2. **Non-Functional Second Brain Launcher**: In `command-centre-shell.tsx`, the Second Brain micro-app button in the left navigation rail has an unassigned `onClick` handler (`onClick: undefined`), giving the appearance that the Second Brain feature is broken even though the backend graph generator and center orbital canvas are functioning.
3. **False-Alarm Integration Fatigue**: Staged and future integration placeholders (Sentry, Cloudflare, CodeRabbit, WorkOS, Convex, NeonDB, Upstash, Slack) are surfaced unconditionally alongside active adapters (Local Git, GitHub, Vercel). They display as unconfigured or error states, creating the false perception that the operational core is non-functional.
4. **Monolithic UI Complexity**: `command-centre-shell.tsx` has grown into a 2,893-line monolith holding dozens of ad-hoc state hooks, making changes risky and obscuring the clean, modular boundary between micro-apps.

Despite these surface issues, the underlying domain layer is exceptionally healthy (167/167 tests passing across Git adapters, routine runners, memory snapshots, and database migrations). Scrapping or restarting the project would discard working domain logic to resolve frontend routing and binding oversights.

---

## Status

Drafted from the approved Council Deliberation findings on 2026-09-20.

---

## Purpose & Product Focus

Refocus Developer Agentic OS on a single, cohesive, high-craft **Personal Developer Work OS**.

The goal of this phase is **Consolidation**:

- Eliminate the dual-frontend split and deliver the **same rich Command Centre experience** both locally and hosted.
- Turn the **Second Brain** into a fully interactive, inspectable micro-app.
- Streamline the **Integrations Catalog** to distinguish active tools from future roadmaps.
- Modularize the frontend architecture into focused, testable micro-app widgets.

---

## Solution Architecture

### 1. Universal Command Centre Shell

Replace the binary `page.tsx` fork with a single unified shell. The shell renders identical navigation, modules, rails, and orbital stages in all environments. The data layer adapts behind standard API contracts:

- **Local Mode**: Backed by the local filesystem store (`.developer-agentic-os/`) and repository context.
- **Hosted Mode**: Backed by Neon Postgres and authenticated Clerk session context, using the same JSON API schemas.

### 2. Interactive Second Brain Canvas

Elevate Second Brain from a passive center orbit into an interactive micro-app:

- Clicking "Second Brain" in the Micro Apps rail opens a dedicated full-stage view or expandable modal canvas.
- Provide zoom, search, node filtering (files, artifacts, skills, work items, signals), and neighbor traversal.
- Preserve the compact orbital stage on the home dashboard for quick glances while delegating deep graph exploration to the micro-app view.

### 3. Transparent Integration Lifecycle

Refactor the integration registry into three explicit status categories:

- **Connected**: Actively authenticated and reporting operational data (e.g., Local Git, configured GitHub/Vercel).
- **Available to Connect**: Supported adapters ready for user credentials (e.g., GitHub, Vercel, Email).
- **Deferred / Staged**: Filtered out of the primary operational dashboard or clearly grouped in a "Future Roadmaps" collapsible tray so they no longer cause alarm.

### 4. Monolith Decomposition

Refactor `src/components/command-centre/command-centre-shell.tsx` into modular component directories:

- `src/components/command-centre/micro-apps/` (WorkspaceSwitcher, FocusBoard, SecondBrainApp, SessionHandoff)
- `src/components/command-centre/orbit/` (ConstellationStage, OrbitNodeRing, GraphLinks, NodeInspector)
- `src/components/command-centre/rails/` (LeftRail, RightRail, HeaderBar)
- `src/components/command-centre/integrations/` (IntegrationsModule, ProviderCard)

---

## User Stories

### Shell Unification & Consistency

1. **As a developer**, I want the exact same visual design, modules, and micro-apps when running locally or on Vercel, so that hosting does not degrade my user experience.
2. **As a developer**, I want authentication to protect the command centre without substituting a hollowed-out dashboard.
3. **As a developer**, I want layout sizing, theme preferences, and rail states to persist consistently across sessions.

### Second Brain

4. **As a developer**, I want clicking "Second Brain" in Micro Apps to open a focused, expandable graph view, so that I can explore my repository memory.
5. **As a developer**, I want to search and filter nodes in Second Brain by type (skills, artifacts, files, work items), so that I can locate specific connections quickly.
6. **As a developer**, I want clicking any graph node to inspect its metadata, file path, and linked artifacts with one-click copy and navigation.
7. **As a developer**, I want the center dashboard orbit to reflect live repository memory changes without page reload.

### Integrations & Operational Clarity

8. **As a developer**, I want connected integrations clearly distinguished from unconfigured and future integrations, so that I know exactly which tools are live.
9. **As a developer**, I want Local Git to operate immediately out of the box without requiring external cloud accounts.
10. **As a developer**, I want actionable inline instructions when setting up GitHub or Vercel tokens, so that configuration is painless.
11. **As a developer**, I want future/staged integrations hidden by default or neatly grouped under an "Upcoming Adapters" section.

### Code Quality & Architecture

12. **As a maintainer**, I want `command-centre-shell.tsx` broken into smaller, single-responsibility components (< 300 lines each), so that the UI can be safely maintained and extended.
13. **As a maintainer**, I want all existing 167 domain test suites to remain 100% green throughout the refactoring.

---

## Technical Specifications

### Component Hierarchy

```
src/components/command-centre/
├── command-centre-shell.tsx         # Lean layout coordinator (< 350 lines)
├── rails/
│   ├── left-rail.tsx                # Micro apps, Workspace Switcher, Calendar
│   ├── right-rail.tsx               # Work Queue, Signal Triage, Skills Deck, Routines
│   └── header-bar.tsx               # Repository indicator, system time, AuthControls
├── orbit/
│   ├── orbital-stage.tsx            # Center canvas container
│   ├── constellation.tsx            # Background SVG stars & nodes
│   ├── graph-links.tsx              # SVG relationship vectors
│   └── node-inspector-modal.tsx     # Deep inspection panel for selected node
├── micro-apps/
│   ├── workspace-switcher-drawer.tsx
│   ├── focus-board-drawer.tsx
│   ├── session-handoff-drawer.tsx
│   └── second-brain-modal.tsx       # Expanded graph exploration canvas
└── integrations/
    ├── integrations-module.tsx      # Active & configurable integration cards
    └── integration-setup-modal.tsx  # Credential guidance dialog
```

### Second Brain Interaction Contract

```typescript
export interface SecondBrainViewOptions {
  filterTypes: Array<"repo" | "area" | "file" | "skill" | "artifact" | "work_item" | "routine">;
  searchQuery: string;
  selectedNodeId: string | null;
  expandedView: boolean; // true when launched from Micro Apps
}
```

When `expandedView` is `false`, Second Brain renders in the center orbital stage (bounded orbit radius). When `expandedView` is `true`, it mounts `SecondBrainModal` offering full-viewport graph navigation, text search, neighborhood highlighting, and deep context links.

---

## Implementation Milestones

### Milestone 1: Immediate Friction Fixes (Day 1)

- [ ] Wire `onClick` for "Second Brain" in `command-centre-shell.tsx` to toggle a dedicated graph exploration dialog/view.
- [ ] Add an empty/loading safeguard to the center orbital stage to prevent visual artifacts on initial load.
- [ ] Update `src/server/integrations/integration-registry.ts` to filter out deferred placeholders from the main dashboard payload, or tag them with `stage: "deferred"` so the UI groups them under an accordion.

### Milestone 2: Monolith Decomposition (Days 2–3)

- [ ] Extract `LeftRail` and `RightRail` into dedicated subcomponents.
- [ ] Extract `OrbitalStage` and `NodeInspector` into `src/components/command-centre/orbit/`.
- [ ] Extract Micro App drawers (`WorkspaceSwitcher`, `FocusBoard`, `SessionHandoff`).
- [ ] Verify `npm run lint`, `npm run typecheck`, and `npm test` after each component extraction.

### Milestone 3: Shell Unification (Days 3–4)

- [ ] Deprecate `HostedCommandCentre` component in favor of `CommandCentreShell`.
- [ ] In `src/app/page.tsx`, retain Clerk session verification on hosted environments, but render the unified `CommandCentreShell` once authenticated.
- [ ] Ensure hosted API routes (`/api/hosted/domain`, `/api/hosted/workspaces`) and local API routes (`/api/second-brain/graph`, `/api/artifacts`, `/api/skills`) share unified data transfer schemas.

### Milestone 4: Enhanced Second Brain & Polish (Days 4–5)

- [ ] Build `second-brain-modal.tsx` with interactive node filtering, search, and neighborhood highlighting.
- [ ] Add E2E Playwright test coverage verifying navigation to Second Brain and integration state rendering.
- [ ] Update `CONTEXT.md` and documentation to formalize the consolidated architecture.

---

## Non-Goals

1. **Rebuilding Backend Domain Services**: The existing stores (`ArtifactStore`, `LocalGitAdapter`, `WorkItemStore`, `RoutineExecutor`, `SecondBrainGraph`) are fully tested and performant. They must not be rewritten.
2. **Adding New Cloud Adapters**: No new third-party integrations (Slack, Cloudflare, Linear) will be introduced until existing GitHub and Vercel connections are polished.
3. **Complex Multi-Tenant Enterprise Administration**: Hosted mode will focus on single-user, multi-workspace personal use without enterprise role hierarchies or team billing.

---

## Verification & Acceptance Criteria

1. **CI Baseline Clean**: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` exits `0`.
2. **Micro-App Functional**: Clicking "Second Brain" in the left rail opens an expanded Second Brain interactive modal with working search and node inspector.
3. **Environment Parity**: Loading the application locally (`http://localhost:3000`) and in hosted mode (`process.env.VERCEL="1"`) displays the same Command Centre shell layout, orbital center stage, and micro-app roster.
4. **Clean Integrations**: The Integration Operations panel displays only active or configurable adapters by default. No misleading errors appear for unconfigured future tools.
