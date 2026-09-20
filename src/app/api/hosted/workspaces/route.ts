import { NextResponse } from "next/server";

import { executeHostedRoute } from "@/app/api/hosted/_shared";
import { applyStandardHeaders, createHostedErrorResponse } from "@/server/hosted-api/contract";

export async function GET(request: Request) {
  return executeHostedRoute(request, async ({ identity, workspaceStore }) => {
    await workspaceStore.ensureDefault(identity.userId);
    const workspaces = await workspaceStore.list(identity.userId);
    await workspaceStore.recordList(identity.userId);
    return NextResponse.json({
      workspaces,
      activeWorkspace: await workspaceStore.active(identity.userId),
    });
  });
}

export async function POST(request: Request) {
  return executeHostedRoute(
    request,
    async ({ identity, workspaceStore, correlationId, version, isVersioned }) => {
      let body: { name?: unknown } | null;
      try {
        body = (await request.json()) as { name?: unknown } | null;
      } catch {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Request body must be valid JSON.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.name !== "string"
      ) {
        if (!isVersioned) {
          return applyStandardHeaders(
            NextResponse.json({ error: "Workspace name is required." }, { status: 400 }),
            correlationId,
            version
          );
        }
        return createHostedErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Workspace name is required.",
          status: 400,
          retryable: false,
          correlationId,
          version,
        });
      }

      const workspace = await workspaceStore.create(identity.userId, body.name);
      return NextResponse.json({ workspace }, { status: 201 });
    }
  );
}
