# Getting Started

This guide gets a fresh checkout of Developer Workflow OS v2 running locally, and it also notes the hosted multi-tenant architecture used when the app is configured for Clerk + Neon + GitHub org-scoped access.

The app can run in local demo mode, but the active hosted product model is multi-tenant: each Clerk organization maps to a Neon `tenant_id`, and GitHub org membership is verified separately from app access before repository data is exposed.

## What you'll need

- Node.js (with npm) and a local Git installation — required to run the app at all.
- A GitHub account — optional, only needed if you want the GitHub Integration Operations
  panel (issues, pull requests, Actions, merge status) to report live data.
- A Vercel account with a project — optional, only needed if you want the Vercel
  Integration Operations panel (deployments, build/runtime logs) to report live data.

The app runs with **no** environment variables configured. Local Git status always works;
GitHub, Vercel, and Email simply show as "unconfigured" until you add credentials.

For the hosted tenant model, the practical requirements are: Clerk org membership for app access, a Neon tenant-scoped database, and GitHub org membership verification before GitHub-backed repository data is visible. This is the setup described in ADR 0001 and ADR 0002.

## Step 1: Install and run

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`. You should see the command centre with the Workspace,
Work Queue, routine executor, and Second Brain panels populated from local Git status.

## Step 2: Create your `.env` file

Copy the template and open it:

```powershell
Copy-Item .env.example .env
```

Leave any section blank to keep that integration unconfigured/deferred — nothing else in
the app depends on the file existing.

## Step 3: Obtain a GitHub token

The GitHub adapter needs a token with read access to Issues, Pull Requests, and Actions
for one repository.

1. Sign in to GitHub and open **Settings → Developer settings**
   (`https://github.com/settings/tokens` while signed in).
2. Choose a token type:
   - **Fine-grained token (recommended)**: click **Fine-grained tokens → Generate new
     token**. Under **Repository access**, select **Only select repositories** and pick
     the repo you want to monitor. Under **Permissions → Repository permissions**, set:
     - **Contents**: Read-only
     - **Issues**: Read-only
     - **Pull requests**: Read-only
     - **Actions**: Read-only
       Click **Generate token** and copy the value — it starts with `github_pat_`.
   - **Classic token**: click **Tokens (classic) → Generate new token (classic)**. Select
     the **repo** scope (or **public_repo** if the repository is public). Click **Generate
     token** and copy the value — it starts with `ghp_`.
3. GitHub only shows the token once. Paste it into `.env`:

   ```
   GITHUB_TOKEN=ghp_your_token_here
   GITHUB_REPOSITORY=your-org/your-repo
   ```

   `GITHUB_REPOSITORY` uses the `owner/repo` form. If you omit it, the app falls back to
   `GITHUB_OWNER` + `GITHUB_REPO`, or to this repository's Git remote origin.

4. Restart `npm run dev` and use the Integration status refresh control — the GitHub
   panel should report "GitHub credentials detected."

If you use GitHub Enterprise Server instead of github.com, also set `GITHUB_API_URL` to
your instance's API base (e.g. `https://github.yourcompany.com/api/v3`).

## Step 4: Obtain a Vercel token

The Vercel adapter needs an access token and a project id.

1. Sign in to Vercel and open **Account Settings → Tokens**
   (`https://vercel.com/account/tokens`).
2. Click **Create Token**. Give it a name (e.g. `developer-workflow-os`), choose an
   expiration, and if you belong to more than one team, scope it to the team that owns
   the project you want to monitor. Click **Create** and copy the token — it's only
   shown once.
3. Paste it into `.env`:

   ```
   VERCEL_TOKEN=your_token_here
   ```

4. Get the project id and (if applicable) team id. Either:
   - **Link the repo with the Vercel CLI** (recommended — no extra env vars needed):

     ```powershell
     npm install -g vercel
     vercel link
     ```

     This writes `.vercel/project.json`, which the adapter reads automatically for
     `projectId` and `orgId` (team id).

   - **Or read them from the dashboard**: open the project on vercel.com, go to
     **Settings → General**, and copy the **Project ID**. If the project belongs to a
     team, copy the **Team ID** from the team's **Settings** page. Set both in `.env`:

     ```
     VERCEL_PROJECT_ID=your_project_id
     VERCEL_TEAM_ID=your_team_id
     ```

5. Restart `npm run dev` and refresh Integration status — the Vercel panel should report
   "Vercel credentials detected."

To disable the Vercel panel entirely instead of leaving it unconfigured, set
`VERCEL_INTEGRATION_ENABLED=false`.

## Supported integrations

| Integration                                                                   | Status without setup    | Env vars                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Local Git                                                                     | Connected automatically | none                                                                                                                              |
| GitHub                                                                        | Unconfigured            | `GITHUB_TOKEN`/`GH_TOKEN`, `GITHUB_REPOSITORY` (or `GITHUB_OWNER`+`GITHUB_REPO`), optional `GITHUB_API_URL`                       |
| Vercel                                                                        | Unconfigured            | `VERCEL_TOKEN`/`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`, `VERCEL_API_URL`, `VERCEL_INTEGRATION_ENABLED` |
| Email                                                                         | Local demo mode         | optional `EMAIL_PROVIDER`, `EMAIL_PROVIDER_DATA`, `EMAIL_ENABLED`                                                                 |
| Sentry, Cloudflare, CodeRabbit, WorkOS, Clerk, Convex, NeonDB, Upstash, Slack | Deferred (staged)       | none yet — no adapter reads environment variables for these                                                                       |

See [.env.example](../.env.example) for the full, commented template.

## Step 5: Validate your setup

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

A healthy checkout exits every command with code `0`.

## Next steps

- [README.md](../README.md) — project overview, local store layout, and current boundaries.
- [CONTEXT.md](../CONTEXT.md) — canonical product terminology.
- [Implementation handoff](implementation-plan-and-validation-strategy.md) — module
  boundaries, routes, and test strategy.
