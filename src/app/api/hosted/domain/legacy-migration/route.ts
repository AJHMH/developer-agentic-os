import { NextResponse } from "next/server";

import { hostedError, hostedIdentity } from "@/app/api/hosted/_shared";
import {
  detectLegacyMemory,
  executeMigration,
  preflight,
} from "@/server/hosted-domain/legacy-memory-migrator";

const views = ["detect", "preflight"] as const;

type LegacyMigrationBody = {
  action?: unknown;
  workspaceId?: unknown;
  repositoryId?: unknown;
};

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const store = identity.domainStore;
  const userId = identity.userId;
  const url = new URL(request.url);

  const view = url.searchParams.get("view");
  const workspaceId = url.searchParams.get("workspaceId");
  const repositoryId = url.searchParams.get("repositoryId");

  if (!views.includes(view as (typeof views)[number])) {
    return NextResponse.json(
      { error: `view must be one of: ${views.join(", ")}` },
      { status: 400 }
    );
  }
  const selectedView = view as (typeof views)[number];

  try {
    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    if (!repositoryId || typeof repositoryId !== "string") {
      return NextResponse.json({ error: "repositoryId is required" }, { status: 400 });
    }
    const repos = await store.listRepositories(userId, workspaceId);
    const repo = repos.find((candidate) => candidate.id === repositoryId);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found in workspace" }, { status: 404 });
    }
    const safeRoot = repo.localPath;

    if (selectedView === "detect") {
      const stats = await detectLegacyMemory(safeRoot);
      return NextResponse.json(stats);
    }

    if (selectedView === "preflight") {
      const report = await preflight(safeRoot, store, userId, workspaceId);
      return NextResponse.json(report);
    }
  } catch (error) {
    return hostedError(error);
  }

  const unreachableView: never = selectedView;
  throw new Error(`Unhandled legacy migration view: ${unreachableView}`);
}

export async function POST(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const store = identity.domainStore;
  const userId = identity.userId;

  let body: LegacyMigrationBody;
  try {
    body = (await request.json()) as LegacyMigrationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, workspaceId, repositoryId } = body;

  if (action !== "execute-legacy-migration") {
    return NextResponse.json({ error: "action must be execute-legacy-migration" }, { status: 400 });
  }

  if (typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (typeof repositoryId !== "string" || !repositoryId) {
    return NextResponse.json({ error: "repositoryId is required" }, { status: 400 });
  }

  try {
    const repos = await store.listRepositories(userId, workspaceId);
    const repo = repos.find((r) => r.id === repositoryId);
    if (!repo) {
      return NextResponse.json({ error: "Repository not found in workspace" }, { status: 404 });
    }
    void repo;

    const result = await executeMigration(workspaceId, repositoryId, store, userId);
    return NextResponse.json(result);
  } catch (error) {
    return hostedError(error);
  }
}
