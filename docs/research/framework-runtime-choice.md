# Framework And Runtime Choice For Developer Agentic OS v2

## Decision Context

Developer Agentic OS v2 has an approved static UI in `index.html` and a previous Python/Flask implementation in `D:\repos\Developer-Workflow-OS`. The next build needs to turn the approved command-centre design into a real application with API-backed widgets, skill execution, routines, artifacts, repo memory, and a central Second Brain graph.

The previous app is valuable as a source of behavior contracts and module boundaries, but the runtime can change. This research compares Next.js App Router, Vite + React with a separate local API, and a continued Python backend approach.

## Primary Sources Consulted

- Next.js deployment and runtime options: https://nextjs.org/docs/pages/getting-started/deploying
- Vercel support for Next.js: https://vercel.com/docs/frameworks/nextjs
- Vite guide: https://vite.dev/guide/
- Vite static deployment guide: https://vite.dev/guide/static-deploy.html
- React learning docs: https://react.dev/learn
- FastAPI docs: https://fastapi.tiangolo.com/
- FastAPI deployment docs: https://fastapi.tiangolo.com/deployment/
- Flask docs: https://flask.palletsprojects.com/en/latest/
- Flask deployment docs: https://flask.palletsprojects.com/en/latest/deploying/

## Option 1: Next.js App Router

Next.js is a React framework that can run a full application with frontend routes and server-side capabilities in one project. Its deployment documentation distinguishes between server-backed deployment and static export; server-backed deployment is needed for server features, while static export has feature limitations. Source: https://nextjs.org/docs/pages/getting-started/deploying

Vercel provides first-party Next.js support, including framework detection and platform integration for Next.js applications. Source: https://vercel.com/docs/frameworks/nextjs

This option fits Developer Agentic OS when the product needs a cohesive application shell, typed API routes, future hosted deployment, dynamic dashboard data, and a clean path from prototype UI to production app.

Tradeoff: existing Python modules would need to be ported, wrapped, or run as a separate service. The previous Python app remains useful as a behavior reference, but not directly reused as runtime code.

## Option 2: Vite + React With A Local API

Vite provides a fast development server and build tooling for frontend applications. Its static deployment guide focuses on building and deploying static assets. Source: https://vite.dev/guide/ and https://vite.dev/guide/static-deploy.html

React itself is framework-agnostic and can power the approved dashboard UI, but Vite does not provide an integrated fullstack application model by default. Source: https://react.dev/learn

This option fits Developer Agentic OS when the priority is a fast local client application and a deliberately separate API server, such as FastAPI or Flask.

Tradeoff: server rendering, API routing, deployment, auth, and backend orchestration become separate decisions. It is simpler than Next.js for a local prototype, but it creates more seams to manage when the application grows.

## Option 3: Python Backend Continuation

Flask is a lightweight Python WSGI web framework. Its deployment documentation describes production deployment through WSGI servers and hosting-specific setup. Source: https://flask.palletsprojects.com/en/latest/ and https://flask.palletsprojects.com/en/latest/deploying/

FastAPI is a Python web framework built around ASGI, type hints, and automatic API documentation. Its deployment documentation discusses ASGI servers such as Uvicorn and production deployment concerns. Source: https://fastapi.tiangolo.com/ and https://fastapi.tiangolo.com/deployment/

This option fits Developer Agentic OS when preserving the previous Python backend code is more important than a unified React application model.

Tradeoff: the frontend still needs a separate modern UI layer, and serving the approved dashboard from Python alone would likely recreate the old static-dashboard limitations.

## Reuse Findings From The Previous App

The previous repository should be mined for backend contracts and tests rather than copied wholesale. Strong reuse candidates include:

- `app/server/api.py` for endpoint shape.
- `app/server/command_centre.py` for artifact storage and run logging.
- `app/server/repo_memory.py` for repo indexing and feature-context mapping.
- `app/server/repo_graph.py` for Second Brain node/link data.
- `app/server/routine_scheduler.py` for routine registration and history.
- `app/server/adapters/git.py` for a source-control adapter seam.
- `app/server/events/registry.py` and `app/server/events/security.py` for event dispatch and webhook signature boundaries.
- Tests under `tests/` as behavior contracts for v2.

Do not carry forward the old dashboard, YouTube/media widgets, Robonuggets branding, Cloudflare-first assumptions, or docs that describe a different runtime than the code actually uses.

## Recommendation

Use **Next.js App Router with TypeScript** as the main v2 application framework.

This is the best default because Developer Agentic OS is now a rich product interface, not just a Python-served static dashboard. Next.js gives one application shell for the approved UI, route-level server capabilities, typed API boundaries, and a direct path to hosted deployment. Source: https://nextjs.org/docs/pages/getting-started/deploying and https://vercel.com/docs/frameworks/nextjs

Keep Python as a reference and optional future service boundary. If a later decision requires preserving Python execution for heavier repo analysis or local automations, use a separate FastAPI service for those workloads. FastAPI is the better Python choice for new JSON APIs because its first-party docs center type-hinted API design, automatic docs, and ASGI deployment. Source: https://fastapi.tiangolo.com/ and https://fastapi.tiangolo.com/deployment/

## Follow-Up Questions

- Should the first build run entirely locally, or should it be deployable to a hosted URL from the start?
- Should any previous Python module be preserved as executable code in v2, or only reimplemented from its tests and contracts?
- Which widgets need live data in the first build versus demo data?
- Should Cloudflare Workers, Workflows, and D1 be deferred until after the local app works?

## Decision Implication

The next Wayfinder decision should resolve the first-build product scope. If that decision confirms a product-grade app rather than a local-only utility, the runtime architecture decision should choose Next.js App Router with TypeScript and treat Python as optional service/reference material.
