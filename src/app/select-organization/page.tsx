import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SelectOrganizationPage() {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    redirect("/");
  }

  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (session.orgId) redirect("/");

  return (
    <main className="auth-page">
      <OrganizationList afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" />
    </main>
  );
}
