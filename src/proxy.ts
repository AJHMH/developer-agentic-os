import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const fixtureMode =
  process.env.NODE_ENV !== "production" && process.env.HOSTED_AUTH_FIXTURE_MODE === "true";

// Routes reachable while signed out. Everything else is gated here (not in page-level
// redirect()s) because Next.js's client router cache can replay a stale cached redirect
// from a Server Component after sign-in state changes, producing a sign-in/home loop in
// production. Gating in proxy runs the check fresh on every request instead.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/(.*)",
]);

export default fixtureMode
  ? () => NextResponse.next()
  : clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) await auth.protect();
    });

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
