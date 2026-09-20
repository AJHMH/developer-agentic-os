import { NextResponse } from "next/server";

import { LocalGitAdapter } from "@/server/git/local-git-adapter";
import { WorkspaceError, workspaceStore } from "@/server/workspace/workspace-store";
import { isHostedMode, resolveHostedWorkspaceContext } from "@/server/workspace/hosted-mode";

export async function GET(request?: Request) {
  if (isHostedMode(request)) {
    if (!request)
      return NextResponse.json({ error: "Request is required in hosted mode" }, { status: 400 });
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;
    const workspaces = await hosted.workspaceStore.list(hosted.userId);
    const entries = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      path: `/workspaces/${ws.name}`,
      git: {
        branch: "main",
        clean: true,
        commitsAhead: 0,
        commitsBehind: 0,
        modifiedCount: 0,
        untrackedCount: 0,
      },
    }));
    return NextResponse.json({ repositories: entries });
  }

  const repositories = await workspaceStore.listRepositories();
  const entries = await Promise.all(
    repositories.map(async (repository) => ({
      ...repository,
      git: await new LocalGitAdapter(repository.path).getStatus(),
    }))
  );
  return NextResponse.json({ repositories: entries });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (isHostedMode(request)) {
    const hosted = await resolveHostedWorkspaceContext(request);
    if (hosted instanceof NextResponse) return hosted;
    const name =
      typeof body?.name === "string" && body.name.trim()
        ? body.name.trim()
        : typeof body?.path === "string" && body.path.trim()
          ? body.path.trim()
          : null;
    if (!name) {
      return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
    }
    const ws = await hosted.workspaceStore.create(hosted.userId, name);
    return NextResponse.json(
      {
        id: ws.id,
        name: ws.name,
        path: `/workspaces/${ws.name}`,
      },
      { status: 201 }
    );
  }

  try {
    const repository = await workspaceStore.registerRepository(body?.path);
    return NextResponse.json(repository, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "INVALID_PATH" ? 400 : 404 }
      );
    throw error;
  }
}
