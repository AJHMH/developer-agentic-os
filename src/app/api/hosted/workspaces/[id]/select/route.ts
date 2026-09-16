import { NextResponse } from "next/server";

import { hostedIdentity, hostedError } from "@/app/api/hosted/_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const hostedWorkspaceStore = identity.workspaceStore;
  try {
    const workspace = await hostedWorkspaceStore.select(identity.userId, (await params).id);
    return NextResponse.json({ workspace });
  } catch (error) {
    return hostedError(error);
  }
}
