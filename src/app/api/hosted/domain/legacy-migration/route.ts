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
  root?: unknown;
};

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const store = identity.domainStore;
  const userId = identity.userId;
  const url = new URL(request.url);

  const view = url.searchParams.get("view");
  const workspaceId = url.searchParams.get("workspaceId");
  const rawRoot = url.searchParams.get("root");
  const root = typeof rawRoot === "string" && rawRoot ? rawRoot : process.cwd();
  const safeRoot = require("node:path").resolve(root);
  if (!safeRoot.startsWith(require("node:path").resolve("/"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  if (!views.includes(view as (typeof views)[number])) {
    return NextResponse.json(
      { error: `view must be one of: ${views.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    if (view === "detect") {
      const stats = await detectLegacyMemory(safeRoot);
      return NextResponse.json(stats);
    }

    if (view === "preflight") {
      if (!workspaceId || typeof workspaceId !== "string") {
        return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
      }
      const report = await preflight(safeRoot, store, userId, workspaceId);
      return NextResponse.json(report);
    }
  } catch (error) {
    return hostedError(error);
  }

  return NextResponse.json({ error: "Unhandled view" }, { status: 400 });
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

  const { action, workspaceId, repositoryId, root } = body;

  if (action !== "execute-legacy-migration") {
    return NextResponse.json({ error: "action must be execute-legacy-migration" }, { status: 400 });
  }

  if (typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (typeof repositoryId !== "string" || !repositoryId) {
    return NextResponse.json({ error: "repositoryId is required" }, { status: 400 });
  }

  const resolvedRoot = typeof root === "string" && root ? root : process.cwd();
  const safeRoot = require("node:path").resolve(resolvedRoot);
  if (!safeRoot.startsWith(require("node:path").resolve("/"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const result = await executeMigration(safeRoot, workspaceId, repositoryId, store, userId);
    return NextResponse.json(result);
  } catch (error) {
    return hostedError(error);
  }
}
