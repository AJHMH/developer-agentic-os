import { NextResponse } from "next/server";

import { LocalGitAdapter } from "@/server/git/local-git-adapter";
import { WorkspaceError, workspaceStore } from "@/server/workspace/workspace-store";

export async function GET() {
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
  const body = await request.json();
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
