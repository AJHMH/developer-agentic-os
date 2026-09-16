import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const hostedMode = process.env.VERCEL === "1";
const fixtureMode =
  process.env.NODE_ENV !== "production" && process.env.HOSTED_AUTH_FIXTURE_MODE === "true";

// Routes reachable without a Clerk session: sign-in/up UI, the OAuth callback, and the
// two endpoints that verify their own signature/OIDC token instead of a Clerk session
// (the Vercel webhook and the GitHub Actions deployment resolver). Everything else is
// gated here (not in page-level redirect()s) because Next.js's client router cache can
// replay a stale cached redirect from a Server Component after sign-in state changes,
// producing a sign-in/home loop in production. Gating in proxy runs the check fresh on
// every request instead.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/webhooks/vercel(.*)",
  "/api/hosted/deployments/resolve(.*)",
]);

export function unauthenticatedApiResponse(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;

  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

// Local (non-Vercel) mode has no Clerk configuration and renders the unauthenticated
// CommandCentreShell instead — never gate it behind Clerk auth.
export default !hostedMode || fixtureMode
  ? () => NextResponse.next()
  : clerkMiddleware(async (auth, request) => {
      if (isPublicRoute(request)) return;

      const session = await auth();
      if (session.userId) return;

      const apiResponse = unauthenticatedApiResponse(request);
      if (apiResponse) return apiResponse;

      return session.redirectToSignIn({ returnBackUrl: request.url });
    });

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
