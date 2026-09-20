# src/server/hosted-auth/auth-adapter.ts

- AuthError · class · L4-L12 — class AuthError extends Error
- constructor · method · L5-L11 — constructor( readonly code: "UNAUTHENTICATED", message = "Authentication is required." )
- AuthAdapter · interface · L14-L16 — interface AuthAdapter
- HostedTokenVerifier · interface · L18-L20 — interface HostedTokenVerifier
- UnconfiguredHostedTokenVerifier · class · L22-L30 — class UnconfiguredHostedTokenVerifier implements HostedTokenVerifier
- verify · method · L23-L29 — async verify(token: string): Promise<HostedIdentity | null>
- TokenAuthAdapter · class · L32-L42 — class TokenAuthAdapter implements AuthAdapter
- constructor · method · L33-L33 — constructor(private readonly verifier: HostedTokenVerifier)
- authenticate · method · L35-L41 — async authenticate(request: Request): Promise<HostedIdentity>
- DeterministicAuthAdapter · class · L44-L66 — class DeterministicAuthAdapter implements AuthAdapter
- constructor · method · L45-L49 — constructor( private readonly fixtureMode = (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") && process.env.HOSTED_AUTH_FIXTURE_MODE === "true" )
- authenticate · method · L51-L65 — async authenticate(request: Request): Promise<HostedIdentity>
- ClerkAuthAdapter · class · L68-L87 — class ClerkAuthAdapter implements AuthAdapter
- authenticate · method · L69-L86 — async authenticate(request: Request): Promise<HostedIdentity>
- authenticate · method · L93-L100 — authenticate(request)
