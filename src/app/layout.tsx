import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Developer Agentic OS",
  description: "A local-first developer command centre for repo-aware agentic workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL === "1" &&
    process.env.HOSTED_AUTH_FIXTURE_MODE === "true";
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{fixtureMode ? children : <ClerkProvider>{children}</ClerkProvider>}</body>
    </html>
  );
}
