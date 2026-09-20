import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { CommandCentreShell } from "@/components/command-centre/command-centre-shell";

export default async function Home() {
  if (process.env.VERCEL === "1") {
    const fixtureMode =
      process.env.NODE_ENV !== "production" && process.env.HOSTED_AUTH_FIXTURE_MODE === "true";
    if (!fixtureMode) {
      const session = await auth();
      if (!session.userId) redirect("/sign-in");
      if (!session.orgId) redirect("/select-organization");
    }
  }
  return <CommandCentreShell />;
}
