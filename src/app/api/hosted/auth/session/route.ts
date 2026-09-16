import { NextResponse } from "next/server";

import { hostedIdentity } from "@/app/api/hosted/_shared";

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  return NextResponse.json({
    identity: {
      userId: identity.userId,
      tenantId: identity.tenantId,
      displayName: identity.displayName,
    },
  });
}
