# Developer Agentic OS v2

Developer Agentic OS v2 is a repository work OS with both local development mode and hosted multi-tenant SaaS mode. In hosted mode it runs on Vercel + Neon, each Clerk organization maps to one tenant, and every database record is scoped by `tenant_id` with GitHub org membership checked separately before repository data is exposed.

The local-first filesystem workflow remains useful for development and quick setup, but the current product architecture is tenant-scoped and organization-aware.

## Run Locally

Requirements: Node.js with npm and a local Git installation.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`. This is the live application and includes the current Workspace, Work Queue, routine executor, and Second Brain updates.

The approved static visual reference remains available at `index.html`, but it is a frozen prototype and does not receive React/Next application updates. Use the Next.js app above for the current experience.

## Local Store

The app creates `.developer-agentic-os/` in each registered Repository Context on first use. It contains:

- `artifacts/`: durable artifact JSON files and an index.
- `repo-memory/`: refreshable repository snapshots.
- `skill-runs/`: skill execution records and statuses.
- `routines/`: routine definitions and execution history.

The store is local and inspectable. To reset generated server state, stop the dev server and run:

```powershell
Remove-Item -Recurse -Force .developer-agentic-os
```

Layout preferences are browser-owned. Use **Reset Layout** in the Layout controls to restore the dashboard baseline, or clear the `developer-agentic-os-layout-v1` local-storage entry in the browser.

## Current Boundaries

Live widgets:

- Artifacts, including artifact detail inspection.
- Skills Deck, including built-in skill runs and model-by-effort configuration.
- Routines, including manual Run Now, pause/resume, and history-backed status.
- Second Brain graph, including repository, area, file, artifact, and skill nodes.
- Layout settings and integration operations status.

Placeholder widgets:

- Micro Apps catalog.
- Calendar and agenda data.
- Email and communication signals.

Integration Operations:

- Local Git is required and reports repository status.
- GitHub MVP reports Issues, Pull Requests, Actions, and merge status when `GITHUB_TOKEN` or `GH_TOKEN` and a repository remote are available.
- Vercel MVP reports deployments and links to build/runtime logs when `VERCEL_TOKEN` or `VERCEL_API_TOKEN` and project configuration are available.
- Sentry, Cloudflare, CodeRabbit, WorkOS, Clerk, Convex, NeonDB, Upstash, Email, and Slack appear as staged health/setup states without unsupported actions.
- Unhealthy GitHub and Vercel results can become repository-scoped Agent Inbox signals and linked Work Items.
- Provider failures are normalized into actionable states such as unconfigured, authentication, rate limit, timeout, unavailable, and unhealthy.
- Integration data refreshes on dashboard load and through the manual Integration status refresh control.

Credentials are environment-based for local development. Hosted SaaS mode uses Clerk org membership, GitHub OAuth, Neon persistence, and tenant-scoped data access; the local JSON store remains a fallback and local-development convenience rather than the active hosted architecture.

Automatic background routine scheduling and persisted user-added Micro Apps remain outside the first local build, while the hosted tenant model is the active architecture for the multi-org product.

## Phase Two

Phase two extends the first build into a multi-repository daily workflow:

- Workspace and Repository Context registration with a live Workspace Switcher.
- A repository-scoped Work Queue for lightweight follow-ups and explicit context references.
- Repository-aware Skill, Routine, Artifact, and Integration execution with provenance.
- A local background Routine executor with leases, pause exclusion, and visible history.
- Second Brain links across Repository Contexts, Work Items, Routines, Skills, Artifacts, and files.

Phase-two implementation tickets are tracked under `.scratch/developer-agentic-os-v2/issues/14-19`. The executor remains process-local; hosted scheduling, authentication, shared Workspaces, and cloud synchronization are intentionally deferred.

Phase-three implementation tickets are tracked under `.scratch/developer-agentic-os-v2/issues/20-25`. Phase Three adds Agent Inbox, signal triage, Today / Focus Board, Session Handoff, provider-neutral Email sync, and explicit Second Brain provenance while keeping Email read-only and local-first.

## Validation

Run the application checks from the repository root:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

To automatically format the codebase with Prettier:

```powershell
npm run format
```

Expected status for a healthy checkout: every command exits with code `0`; the unit and contract suite reports passing tests, and the Playwright suite reports smoke tests. Playwright uses an isolated local dev server on port `3100` and installs Chromium with:

```powershell
npx playwright install chromium
```

## CI/CD and Quality Gates

The repository is protected by GitHub Actions workflows and a Main Branch Ruleset:

- **CI Workflow** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): Runs on every push and pull request to `main`. Executes Prettier format check (`npm run format:check`), ESLint (`npm run lint`), TypeScript typechecking (`npm run typecheck`), unit & integration tests (`npm test`), and Next.js application build (`npm run build`).
- **CodeQL Security Analysis** ([.github/workflows/codeql.yml](.github/workflows/codeql.yml)): Performs advanced static code analysis and vulnerability scanning for JavaScript/TypeScript on pushes, pull requests, and a weekly schedule.
- **Dependabot** ([.github/dependabot.yml](.github/dependabot.yml)): Automatically checks for npm dependency vulnerabilities and GitHub Actions version updates on a weekly schedule.
- **Main Branch Ruleset** ([.github/rulesets/main-ruleset.json](.github/rulesets/main-ruleset.json)): Enforces active branch protection on `main`, requiring pull requests, thread resolution, blocking force pushes and deletions, and requiring all CI checks (`Lint, Format & Typecheck`, `Run Unit & Integration Tests`, `Build Application`, and `CodeQL`) to pass before merging. Synchronize and verify the ruleset against the GitHub repository anytime with `npm run ruleset:sync`.

## Project References

- [Getting started](docs/getting-started.md): install and run the app, and obtain GitHub and Vercel tokens for the Integration Operations panel.
- [Domain context](CONTEXT.md): canonical product terminology and first-build boundaries.
- [Wayfinder map](.wayfinder/map.md): resolved product and architecture decisions.
- [Implementation handoff](docs/implementation-plan-and-validation-strategy.md): module boundaries, routes, test strategy, and browser checks.
- Phase Three graph and Local Store boundaries, focused checks, and full validation commands are documented in the implementation handoff.
- [Build issue set](.scratch/developer-agentic-os-v2/issues/build-developer-agentic-os-v2.md): original first-build specification.
- [Integration Operations issue](.scratch/developer-agentic-os-v2/issues/26-integration-operations-layer.md): completed GitHub/Vercel operations scope and staged integration roadmap.
- [Static visual reference](index.html): approved command-centre direction.

## Visual Direction

The first screen is the usable command centre rather than a landing page. It uses a dark, orange, and off-white visual system with a central orbital Second Brain, live workflow panels, bounded resizing, and no YouTube or Robonuggets references.
