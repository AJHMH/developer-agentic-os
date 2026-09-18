# Agent Instructions

## Project overview

Developer Agentic OS v2 is a repository work OS with a local command centre and a hosted multi-tenant SaaS mode. It is a single npm package using Next.js 16 App Router, React 19, strict TypeScript, Clerk authentication, and Neon Postgres; hosted deployments run on Vercel.

- `src/app/`: application pages and API routes; `src/components/`: interactive UI.
- `src/server/`: domain services, persistence, adapters, and workspace context; `src/types/`: shared contracts.
- `tests/`: Node test-runner tests and Playwright browser coverage.
- `migrations/`: database SQL; `scripts/`: migration and ruleset tooling.
- `index.html` is a frozen visual prototype. Implement application changes in the Next.js app.

## Setup and development

Use Node.js 24 (matching CI), npm, and Git. Run commands from the repository root.

- Install reproducibly with `npm ci`; use `npm install <package>` for intentional dependency changes and include `package-lock.json`.
- Start the hot-reloading app with `npm run dev` at `http://localhost:3000`.
- Local demo mode needs no credentials. For integrations, create a local `.env` from [.env.example](.env.example) without overwriting existing values; follow [getting started](docs/getting-started.md).
- For hosted database setup or migration, consult [the migration guide](NEON-MIGRATION-GUIDE.md), [the checklist](NEON-MIGRATION-CHECKLIST.md), and [the schema](docs/NEON-SCHEMA.md) before acting. Confirm the target database and obtain authorization before mutating hosted data.
- Local runtime state is stored in `.developer-agentic-os/` for each registered repository. Preserve it unless the user explicitly requests a reset.

## Validation and code style

The CI baseline is `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build`.

- `npm test` runs Node's test runner over `tests/*.test.mjs`, then TypeScript tests through `tsx`; this is not Jest or Vitest.
- Focus a TypeScript test with `npx tsx --test tests/focus-board.test.ts`; focus JavaScript coverage with `node --test tests/scaffold.test.mjs`.
- Install Chromium with `npx playwright install chromium`; run browser checks with `npm run test:e2e`. The local Playwright configuration uses port 3100. Use `npm run test:e2e:hosted` for hosted coverage after inspecting [its configuration](playwright.hosted.config.ts) for fixtures and prerequisites.
- Add or update regression tests for changed behavior. Run the narrow affected tests first, the CI baseline before submitting code, and relevant browser suites for UI or hosted flows. Report failures and unavailable prerequisites explicitly. No numeric coverage threshold is prescribed here.
- Follow existing TypeScript and React patterns; strict mode and the `@/*` alias are configured in [tsconfig.json](tsconfig.json). Keep server credentials and persistence logic in server modules.
- ESLint treats warnings as failures. Use Prettier for formatting; prefer `npx prettier --write <changed-file>` for scoped edits because `npm run format` rewrites the whole repository.

## Build, deployment, and security

- Build with `npm run build` (Next.js output in `.next/`); run the production build locally with `npm start`.
- [CI](.github/workflows/ci.yml) runs formatting, lint, typechecking, tests, and build for PRs to main and pushes to main. [CodeQL](.github/workflows/codeql.yml) supplies security analysis. Browser suites are additional local checks, not jobs in that CI workflow.
- Respect the live main-branch ruleset, required reviews, and thread resolution. `npm run ruleset:sync` changes repository protection settings; run it only with explicit authorization.
- Keep secrets in local environment configuration or provider secret stores, out of commits, logs, PR bodies, and chat. Authenticate CLIs interactively when needed; never request token values in chat.
- Preserve tenant isolation: derive the tenant from authenticated Clerk organization context, scope repository data by tenant, and enforce GitHub organization entitlement separately. Local demo or test fixtures must not bypass hosted authorization.

## Safe Git branch workflow

`safe-git-branch-workflow`, version `1.0.0`, translates the supplied JSON into an opt-in agent procedure, not an installed automation engine. Activate only when the user requests the full workflow, for example: "run my safe branch workflow", "start git workflow", "prepare a branch and merge safely", "handle my full git workflow", or "automate my git process". Merely reading this file does not authorize creating branches, committing, pushing, or merging. Honor narrower user instructions.

### Inputs and preflight

- `branchName`: optional; default to `feature/<UTC ISO timestamp with colons and periods replaced by hyphens>`. Validate with `git check-ref-format --branch "$branchName"`, reject option-like names and protected branch names, and check for existing local and remote branches. Quote all values as data; do not interpolate inputs into shell code or use `eval`.
- `commitMessage`: required before committing. Ask for it when absent; use a descriptive message and PR title summarizing the intended change.
- `testCommand`: optional additional local check. Default to the CI baseline above; inspect a supplied command before execution and do not let it replace required checks.
- Inspect `git status --short`, the current branch, staged and unstaged diffs, and `origin`; confirm the GitHub repository with `gh repo view` and authentication with `gh auth status`. Resolve any merge/rebase in progress before starting. Identify the intended files and commits; pause when ownership or scope is ambiguous. Preserve unrelated changes and existing staged work.
- Confirm `main` is the intended base and the Vercel project/team identity and read access are available. App read-only integration credentials may not permit pushing or merging; use appropriately authorized Git and GitHub CLI credentials. Missing permissions or deployment evidence block the workflow.

### Execution gates

1. **Branch:** Fetch `origin` and compare the current history with `origin/main`. From a clean checkout, use `git switch -c "$branchName" origin/main`. If carrying uncommitted work or existing commits, confirm its base and scope before using `git switch -c "$branchName"`; pause if safe carryover is uncertain. Never reset, discard, or automatically stash user work.
2. **Validate:** Run the CI baseline and any supplied additional check, plus relevant browser coverage. Every command must exit zero. On failure, report the failing command and pause for the user to fix it or authorize a fix. Rerun checks after changes; do not spin in an unbounded retry loop.
3. **Commit:** Review the complete proposed diff and check for secrets and generated files. Stage only approved paths with `git add -- <paths>` rather than `git add .`; inspect `git diff --cached` to ensure no unrelated staged changes enter the commit. Commit with `git commit -m "$commitMessage"`. If there is nothing to commit, skip the empty commit and continue only if existing intended commits differ from main.
4. **Push and PR:** Record `headSha` from `git rev-parse HEAD`, then `git push -u origin "$branchName"`. Reuse an existing open PR for this repository, head, and base, or create one with `gh pr create --base main --head "$branchName" --title "$prTitle" --body "$prBody"`. Include scope, validation results, and the related issue when applicable. Record the numeric PR number and URL; GitHub merge APIs take a PR number, not a branch name.
5. **GitHub checks:** Inspect `gh pr view "$prNumber" --json headRefOid,statusCheckRollup,reviewDecision,mergeStateStatus` and `gh pr checks "$prNumber"`. Require the PR head to equal `headSha`, all expected CI and CodeQL checks to be present and successful, and all live required checks, reviews, and thread-resolution rules to be satisfied. Read both check runs and commit statuses; the combined commit-status endpoint alone is insufficient. Missing, skipped, neutral, cancelled, or failed expected checks are not success.
6. **Vercel preview:** Find the deployment for the confirmed project/team, repository, branch, and exact `headSha`, using the Vercel API or an authenticated provider tool. With `GET /v6/deployments?projectId=<projectId>` (and `teamId` for a team), paginate and filter deployment metadata such as `meta.githubCommitSha`; do not accept the first or latest project deployment blindly. Require the matching preview deployment's `readyState` to be `READY`; record its ID and URL. `ERROR`, `CANCELED`, missing configuration, or unavailable metadata blocks merging. A green deployment for another SHA is insufficient.
7. **Bounded monitoring:** Use supported check/deployment watchers with a 20-second interval where available and a 20-minute total deadline per gate. Respect API rate limits and Retry-After. If the execution environment cannot wait safely, report pending status and a resume command instead of a shell sleep loop. On timeout or terminal failure, retain the branch and PR and report the blocker. A new PR head invalidates the recorded results: validate and monitor the new SHA before proceeding.
8. **Merge:** Recheck the head SHA, GitHub gates, and matching Vercel readiness immediately before merging. Run `gh pr merge "$prNumber" --squash --match-head-commit "$headSha"` without bypass/admin flags. Respect merge queues; a queued request is not a completed merge. Confirm the PR is `MERGED` and record its merge commit before cleanup. Never force a merge past repository protections.
9. **Sync main:** Ensure the worktree is clean and its branch still points at the merged `headSha`; otherwise pause and preserve new work. Switch with `git switch main`, fetch with `git fetch origin`, and fast-forward with `git pull --ff-only origin main`. If local main does not exist, create it tracking `origin/main`. If main has diverged, stop without resetting it. Verify `git rev-parse HEAD` equals `git rev-parse origin/main` and that the recorded squash merge commit is an ancestor of main.
10. **Cleanup:** Only after verified merge and sync, delete the remote feature branch with `git push origin --delete "$branchName"` if it still exists and still points to the merged head. Preserve it if new commits appeared. Delete the local branch with `git branch -d "$branchName"` while on main. Squash merging may make `-d` refuse deletion; retain the branch and ask for explicit permission before considering `-D`. Treat provider auto-deletion as already complete.
11. **Report:** Return the PR URL and merge SHA, local validation results, GitHub check results, matching preview URL/SHA, branch cleanup status, and main/origin hash comparison. Preview success does not prove post-merge production deployment success; report production as unverified unless separately checked against the merge commit. Distinguish completed, pending, and blocked stages; never claim full completion when cleanup or sync remains blocked.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository centered on `CONTEXT.md`, with ADRs under `docs/adr/`. See `docs/agents/domain.md`.

The active hosted architecture is multi-tenant: each Clerk organization maps to one Neon `tenant_id`, GitHub org membership is checked separately from app access, and repository data is scoped to the authenticated org. ADR 0001 and ADR 0002 capture the implemented design.

<!-- graft:start -->

## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
