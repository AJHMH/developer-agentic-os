import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export default function SignInPage() {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    redirect("/");
  }
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SignIn />
    </div>
  );
}
