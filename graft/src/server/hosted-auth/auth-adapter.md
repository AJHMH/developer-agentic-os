# src/server/hosted-auth/auth-adapter.ts

- AuthError · class · L4-L12 — class AuthError extends Error
- constructor · method · L5-L11 — constructor( readonly code: "UNAUTHENTICATED", message = "Authentication is required." )
- AuthAdapter · interface · L14-L16 — interface AuthAdapter
- HostedTokenVerifier · interface · L18-L20 — interface HostedTokenVerifier
- UnconfiguredHostedTokenVerifier · class · L22-L30 — class UnconfiguredHostedTokenVerifier implements HostedTokenVerifier
- verify · method · L23-L29 — async verify(token: string): Promise<HostedIdentity | null>
- ClerkTokenVerifier · class · L32-L85 — class ClerkTokenVerifier implements HostedTokenVerifier
- constructor · method · L33-L36 — constructor( private readonly verifyFn: typeof verifyToken = verifyToken, private readonly secretKey = process.env.CLERK_SECRET_KEY )
- verify · method · L38-L84 — async verify(token: string): Promise<HostedIdentity | null>
- TokenAuthAdapter · class · L87-L97 — class TokenAuthAdapter implements AuthAdapter
- constructor · method · L88-L88 — constructor(private readonly verifier: HostedTokenVerifier)
- authenticate · method · L90-L96 — async authenticate(request: Request): Promise<HostedIdentity>
- DeterministicAuthAdapter · class · L99-L121 — class DeterministicAuthAdapter implements AuthAdapter
- constructor · method · L100-L104 — constructor( private readonly fixtureMode = (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") && process.env.HOSTED_AUTH_FIXTURE_MODE === "true" )
- authenticate · method · L106-L120 — async authenticate(request: Request): Promise<HostedIdentity>
- ClerkAuthAdapter · class · L123-L142 — class ClerkAuthAdapter implements AuthAdapter
- authenticate · method · L124-L141 — async authenticate(request: Request): Promise<HostedIdentity>
- authenticate · method · L148-L177 — async authenticate(request)
