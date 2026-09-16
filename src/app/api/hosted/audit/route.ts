import { NextResponse } from "next/server";

import { hostedIdentity } from "@/app/api/hosted/_shared";

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const { domainStore: hostedDomainStore, workspaceStore: hostedWorkspaceStore } = identity;
  const [workspaceEvents, workspaces] = await Promise.all([
    hostedWorkspaceStore.audit(identity.userId),
    hostedWorkspaceStore.list(identity.userId),
  ]);
  const domainEvents = (
    await Promise.all(
      workspaces.map((workspace) => hostedDomainStore.audit(identity.userId, workspace.id))
    )
  ).flat();
  return NextResponse.json({
    events: [...workspaceEvents, ...domainEvents].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
    ),
  });
}
