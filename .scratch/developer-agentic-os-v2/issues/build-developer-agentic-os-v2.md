---
title: Build Developer Agentic OS v2
labels:
  - ready-for-agent
status: open
source_map: ../../../.wayfinder/map.md
source_handoff: ../../../docs/implementation-plan-and-validation-strategy.md
---

## Problem Statement

The user has an approved visual direction for Developer Agentic OS, but the current repository is still mostly a static prototype and planning artifacts. The user needs a real first-build application that preserves the approved command-centre experience while turning the developer workflow core into live product behavior.

The app must help a builder understand and operate repo-aware work from one surface: artifacts, built-in skills, manual routines, a Second Brain graph, local git status, optional GitHub metadata, and persistent layout preferences. It must avoid the previous attempt's unwanted scope, including YouTube widgets, audience metrics, Robonuggets branding, and Cloudflare-first assumptions.

## Solution

Build Developer Agentic OS v2 as a product-grade, local-first Next.js App Router application with TypeScript. Port the approved static dashboard into typed components, use Next.js route handlers for first-build APIs, and implement local filesystem-backed storage under the Local Store.

The first build will make Artifacts, Skills Deck, Routines, Second Brain, local git, optional GitHub status, and layout settings live. Calendar, Email, and Micro Apps remain realistic placeholder widgets until their integrations or persistence models are intentionally designed. The previous Python application is used as reference material for behavior contracts, module boundaries, and tests, not as the main runtime.

## User Stories

1. As a developer, I want Developer Agentic OS to open as a real application, so that I can use it as my command centre instead of a static mockup.
2. As a developer, I want the dashboard to preserve the approved dark command-centre design, so that the first build feels like the accepted product direction.
3. As a developer, I want the app name to be Developer Agentic OS everywhere, so that the product identity is consistent.
4. As a developer, I want no YouTube, audience-metrics, media-performance, or Robonuggets references, so that the app stays focused on my developer workflow.
5. As a developer, I want Micro Apps, Calendar, Artifacts, Second Brain, Email, Skills Deck, and Routines visible on the first screen, so that the OS shape remains intact.
6. As a developer, I want Calendar to show local or demo agenda data in the first build, so that the panel supports the design without blocking on calendar integration.
7. As a developer, I want Email to show placeholder communication signals in the first build, so that the panel supports triage shape without requiring email credentials.
8. As a developer, I want Micro Apps to show a placeholder catalog in the first build, so that the OS can show available tools before user-added micro app persistence exists.
9. As a developer, I want Artifacts to be backed by real local data, so that generated results are durable and reviewable.
10. As a developer, I want to list recent Artifacts, so that I can see what the system has produced lately.
11. As a developer, I want to open an Artifact detail, so that I can inspect the durable output of a skill or routine.
12. As a developer, I want Artifact content to support Markdown text or structured JSON, so that different workflow outputs can be represented naturally.
13. As a developer, I want Artifact storage to be inspectable on disk, so that local-first state remains transparent and easy to troubleshoot.
14. As a developer, I want the Local Store to initialize automatically, so that first run does not require manual folder setup.
15. As a developer, I want Local Store path handling to reject traversal, so that reading Artifacts cannot escape the intended storage root.
16. As a developer, I want repo memory to be stored as a refreshable snapshot, so that the dashboard and skills can read workspace context quickly.
17. As a developer, I want to refresh repo memory on demand, so that the Second Brain and skills can reflect the latest repository state.
18. As a developer, I want local git to be the required first-build integration, so that repo-aware workflows work without cloud setup.
19. As a developer, I want the app to detect the current branch, so that branch-aware skills have useful defaults.
20. As a developer, I want the app to inspect changed files, so that release and branch summaries can surface likely impact.
21. As a developer, I want the app to show recent commits, so that the command centre reflects current repo motion.
22. As a developer, I want non-git folders to show a clear integration state, so that the dashboard does not break outside a git checkout.
23. As a developer, I want GitHub to activate when credentials exist, so that PR and branch metadata can enrich local git data.
24. As a developer, I want GitHub to be optional, so that the app remains useful without a token.
25. As a developer, I want missing optional integrations to appear as available rather than broken, so that setup gaps do not read as product failure.
26. As a developer, I want Jira, Linear, Slack, email providers, observability tools, GitLab, and Cloudflare to be shown as deferred or available, so that future integrations are visible without blocking the first build.
27. As a developer, I want integration cards to expose status, capabilities, and setup guidance, so that I can understand what each integration would unlock.
28. As a developer, I want the Skills Deck to list real built-in Skill Commands, so that I can trigger useful repo-aware workflows.
29. As a developer, I want `/repo-summary` to run as a built-in skill, so that I can summarize the current repository quickly.
30. As a developer, I want `/branch-summary` to run as a built-in skill, so that I can understand branch changes against a base branch.
31. As a developer, I want `/release-readiness` to run as a built-in skill, so that I can see readiness signals and blockers.
32. As a developer, I want `/implementation-checklist` to run as a built-in skill, so that I can turn work item text into a concrete checklist.
33. As a developer, I want `/sprint-digest` to run as a built-in skill, so that I can summarize recent work.
34. As a developer, I want placeholder skill cards for non-core commands, so that the deck can show future product shape without fake execution.
35. As a developer, I want a Skill Command to be a typed object, so that skill execution is testable and not arbitrary shell execution.
36. As a developer, I want the slash-command string to be display syntax, so that the product model can carry richer metadata than a label.
37. As a developer, I want pressing Run on a skill card to create a Skill Run Record, so that execution history is preserved.
38. As a developer, I want skill cards to show queued, running, succeeded, and failed states, so that I can see what is happening.
39. As a developer, I want successful durable skill outputs to create Artifacts, so that results can be reopened later.
40. As a developer, I want failed skill runs to record error details without creating success artifacts, so that failures are visible but not misleading.
41. As a developer, I want to retry a failed skill with the same settings, so that recovery is quick.
42. As a developer, I want `/branch-summary` to ask for base and target branch, so that the comparison is explicit.
43. As a developer, I want `/implementation-checklist` to ask for feature or work item text, so that the output is grounded in the request.
44. As a developer, I want skills that can run from repo context to avoid unnecessary prompts, so that common actions are fast.
45. As a developer, I want a model-by-effort matrix to configure skill defaults, so that skill cards match the approved interaction design.
46. As a developer, I want built-in skill settings persisted in the Local Store, so that defaults survive reloads.
47. As a developer, I want Routines to show schedule-aware state, so that planned workflows are visible even before background scheduling exists.
48. As a developer, I want to manually run a routine, so that I can trigger recurring workflow behavior on demand.
49. As a developer, I want `nightly_repo_digest` to be a real routine, so that daily repo summarization has a product path.
50. As a developer, I want `weekly_sprint_digest` to be a real routine, so that weekly recap behavior is represented.
51. As a developer, I want `release_readiness_scan` to be a real routine, so that release health can be checked on demand.
52. As a developer, I want `stale_branch_check` and `artifact_cleanup` to appear as placeholders, so that later routine expansion is visible but not overbuilt.
53. As a developer, I want routine statuses to include queued, next, running, succeeded, failed, paused, and missed, so that routine state is explicit.
54. As a developer, I want the UI to display Fired for completed routines where appropriate, so that the screenshot language can remain while internal status stays precise.
55. As a developer, I want every routine run to create a Routine Execution Record, so that routine history is durable.
56. As a developer, I want routine outputs to link Artifact IDs, so that history does not duplicate durable content.
57. As a developer, I want routines to call Skill Registry handlers when possible, so that skill and routine behavior stay consistent.
58. As a developer, I want to pause and resume individual routines, so that I can control scheduled workflow surfaces.
59. As a developer, I want paused routines to remain visible, so that disabled automation is still understandable.
60. As a developer, I want the Second Brain graph to contain repo, area, file, artifact, and skill nodes, so that the visual brain reflects real repo work.
61. As a developer, I want the Second Brain graph to use contains, references, produced, and used_context links, so that graph relationships are meaningful.
62. As a developer, I want Artifacts to link to files or areas through explicit Context References, so that the graph does not rely on hidden guesses.
63. As a developer, I want built-in skills to appear as graph nodes, so that skills feel connected to repo work and produced artifacts.
64. As a developer, I want the graph to come from a refreshable Repo Memory Snapshot, so that UI reads are fast and predictable.
65. As a developer, I want clicking a file node to open an Inspector Panel, so that I can see file path and type.
66. As a developer, I want clicking an artifact node to open metadata and an open action, so that graph output is inspectable.
67. As a developer, I want clicking a skill node to show latest run status and actions, so that the graph can lead back into workflow.
68. As a developer, I want routines, integrations, people, external issues, and live email/calendar objects deferred from the first graph, so that the graph stays focused.
69. As a developer, I want the page frame and central orbit to be resizable, so that I can adjust the command centre to my screen.
70. As a developer, I want major widgets and skill cards to be resizable, so that I can make dense panels fit my workflow.
71. As a developer, I want resized dimensions to persist after reload, so that I do not lose my layout.
72. As a developer, I want Reset layout to restore approved baseline dimensions, so that I can recover from bad layout changes.
73. As a developer, I want widgets to enforce content-safe minimums, so that resizing does not hide their title/action rows or all meaningful content.
74. As a developer, I want overflowing widget content to scroll inside the widget, so that the page layout stays intact.
75. As a mobile user, I want resizing to be vertical-only, so that horizontal overflow does not break the responsive layout.
76. As a developer, I want drag and reorder deferred from the first build, so that resizing ships without a fragile layout model.
77. As a developer, I want the first build to run locally without hosted accounts, so that setup is low-friction.
78. As a developer, I want the app to be deployable by design, so that a hosted version remains possible later.
79. As a developer, I want the previous Python app used as behavior reference, so that useful repo-memory, artifact, routine, and release concepts are not lost.
80. As a developer, I want the first-build implementation to be TypeScript, so that the main app has one typed runtime.

## Implementation Decisions

- Developer Agentic OS v2 will use Next.js App Router with TypeScript as the Main App Runtime.
- First-build API behavior will live in Next.js route handlers.
- The previous Python implementation will be reference material for behavior contracts, module boundaries, and tests, not the main runtime.
- A future Python/FastAPI Service Boundary is allowed only if a specific workload needs it.
- The approved static dashboard remains the visual source of truth until the React component port is complete.
- The Command Centre will be split into typed components for shell, Micro Apps, Calendar, Artifacts, Second Brain, Email, Skills Deck, Routines, layout controls, model/effort configuration, and inspection.
- The first build will use the Local Store as the filesystem-backed storage root.
- Artifacts will be stored as individual JSON files plus an index.
- Artifact content may be Markdown text or structured JSON.
- Repo Memory Snapshots will be stored as refreshable JSON records.
- Skill Run Records will be stored separately from durable Artifacts.
- Routine Execution Records will link to produced Artifacts by ID rather than duplicating content.
- Browser layout preferences will use `localStorage` in the first build.
- Layout settings include page width, orbit size, widget dimensions, skill-card dimensions, and Reset Layout behavior.
- The Skills Deck will use a typed Skill Registry.
- Built-In Skills are `/repo-summary`, `/branch-summary`, `/release-readiness`, `/implementation-checklist`, and `/sprint-digest`.
- Placeholder Skills remain visible but do not execute real handlers.
- A Skill Command contains identity, display metadata, model and effort defaults, input requirements, status, and a handler.
- Running a skill creates a Skill Run Record and transitions status through queued, running, and succeeded or failed.
- Successful durable skill outputs create Artifacts.
- Failed skill runs record error details and do not create success Artifacts.
- The model-by-effort matrix edits future default model and effort settings.
- Routines will support manual run, schedule-aware display, pause/resume, and persisted history.
- First-build real routines are `nightly_repo_digest`, `weekly_sprint_digest`, and `release_readiness_scan`.
- Placeholder routines are `stale_branch_check` and `artifact_cleanup`.
- Routine statuses are queued, next, running, succeeded, failed, paused, and missed.
- UI labels may display Fired for the internal succeeded status.
- Routines should invoke Skill Registry handlers where behavior matches a skill.
- Local git is the only mandatory first-build integration.
- GitHub is optional and activates when token credentials exist.
- GitHub first-build scope is PR and branch metadata.
- Missing optional integrations render as Available Integrations rather than broken states.
- Deferred integrations include GitLab, Jira, Linear, Slack, email providers, observability tools, Cloudflare Workers, Cloudflare Workflows, and D1.
- Integration Adapters expose identity, kind, status, capabilities, and setup guidance.
- The Second Brain graph will contain repo, area, file, artifact, and skill Graph Nodes.
- The Second Brain graph will use contains, references, produced, and used_context Graph Links.
- Artifacts connect to files or areas through explicit Context References.
- Built-In Skills appear as graph nodes and link to produced Artifacts.
- Selecting a Graph Node opens an Inspector Panel.
- Routines, integrations, people, external issues, and live email/calendar objects are deferred from the first-build graph.
- Persisted user-added Micro Apps are out of scope for the first build.
- The first build may show a static placeholder Micro App catalog.
- Drag and reorder are out of scope for the first build.
- Automatic background routine execution is out of scope for the first build.
- Automatic migration from the previous `.memory` folder is out of scope for the first build.

## Testing Decisions

- Tests should verify external behavior at stable seams rather than internal implementation details.
- The primary test seam is the Next.js route handler plus typed domain module boundary.
- Route handler tests should cover artifacts, skills, routines, repo memory, Second Brain graph, integrations, and health behavior.
- Server module unit tests should cover Local Store safety, Artifact indexing, Skill Registry behavior, skill run lifecycle, routine execution records, integration status, repo memory snapshots, and graph node/link contracts.
- Browser tests should cover the approved command-centre flows rather than component internals.
- Playwright smoke tests should verify the dashboard loads as Developer Agentic OS.
- Playwright smoke tests should verify no YouTube or Robonuggets text appears.
- Playwright smoke tests should verify the main layout contains Micro Apps, Calendar, Artifacts, Second Brain, Email, Skills Deck, and Routines.
- Playwright smoke tests should verify the Skills Deck opens the model-by-effort matrix.
- Playwright smoke tests should verify running a Built-In Skill changes run status and produces visible output.
- Playwright smoke tests should verify Artifacts can be opened from the Artifacts panel.
- Playwright smoke tests should verify manual routine runs update history or status.
- Playwright smoke tests should verify clicking a Second Brain node opens the Inspector Panel.
- Playwright smoke tests should verify layout resizing works and Reset Layout restores baseline dimensions.
- Playwright smoke tests should verify desktop and mobile viewports have no horizontal overflow.
- Prior test art exists in the previous Python app for API endpoints, repo memory, repo graph, routines, artifacts, git adapters, release readiness, and integration status.
- Previous Python tests should be treated as behavior examples and ported to TypeScript test equivalents where they match v2 decisions.

## Out of Scope

- YouTube widgets.
- Audience metrics.
- Subscriber counts.
- Media-performance dashboards.
- Robonuggets branding.
- Persisted user-added Micro Apps.
- Drag-to-reorder widgets.
- Automatic background routine workers.
- Automatic migration from the previous app's `.memory` folder.
- Cloudflare Workers, Workflows, D1, or edge sync.
- Real Jira, Linear, Slack, email provider, observability, GitLab, GitHub Issues, GitHub Actions, release, or full repo sync integrations.
- Python as the main first-build runtime.

## Further Notes

The Wayfinder map for this effort is closed and contains the full decision trail. The final implementation handoff provides the recommended build sequence and validation plan. The first implementation phase should convert the existing prototype into a Next.js App Router app, then build Local Store, route handlers, typed domain modules, and live widgets in thin vertical slices.

After this spec, the next process step is to split the spec into agent-ready implementation tickets.
