import { OrganizationList } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SelectOrganizationPage() {
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (session.orgId) redirect("/");

  return (
    <main className="auth-page">
      <OrganizationList afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" />
    </main>
  );
}