"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SsoCallbackPage() {
  const router = useRouter();
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  useEffect(() => {
    if (!hasClerk) {
      router.replace("/");
    }
  }, [hasClerk, router]);

  if (!hasClerk) {
    return null;
  }
  return <AuthenticateWithRedirectCallback signInForceRedirectUrl="/" signUpForceRedirectUrl="/" />;
}
