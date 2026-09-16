import { NextResponse } from "next/server";

import {
  OperationalStore,
  OperationalStoreError,
  inputFingerprint,
} from "@/server/operational/operational-store";
import { repositoryContextForRequest } from "@/server/workspace/request-context";
import { WorkspaceError } from "@/server/workspace/workspace-store";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const body = await request.json();
    const context = await repositoryContextForRequest(request, body);
    const store = new OperationalStore(context.path);
    const runId = (await params).id;
    const current = (await store.listRuns({ repositoryId: context.id })).find(
      (item) => item.id === runId
    );
    if (!current) return NextResponse.json({ error: "Automation run not found." }, { status: 404 });
    const run =
      body.action === "approve"
        ? await store.approveRun(current.id, context.id, {
            actor: typeof body.actor === "string" ? body.actor : "developer",
            approvedAt: new Date().toISOString(),
            inputFingerprint: inputFingerprint(current.input),
            action: typeof body.providerAction === "string" ? body.providerAction : "diagnostic",
          })
        : body.action === "retry"
          ? await store.retryRun(
              current.id,
              context.id,
              typeof body.error === "string" ? body.error : "Automation failed.",
              typeof body.backoffMs === "number" ? body.backoffMs : 1_000
            )
          : body.action === "pause" || body.action === "resume" || body.action === "cancel"
            ? await store.transitionRun(
                current.id,
                context.id,
                body.action === "pause"
                  ? "paused"
                  : body.action === "resume"
                    ? "queued"
                    : "cancelled"
              )
            : (() => {
                throw new OperationalStoreError(
                  "INVALID_INPUT",
                  "A valid operational run action is required."
                );
              })();
    return NextResponse.json(run);
  } catch (error) {
    if (error instanceof OperationalStoreError)
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "NOT_FOUND" ? 404 : 400 }
      );
    if (error instanceof WorkspaceError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Invalid automation run update." }, { status: 400 });
  }
}
