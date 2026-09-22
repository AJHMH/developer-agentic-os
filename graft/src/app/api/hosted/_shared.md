# src/app/api/hosted/_shared.ts

- HostedRouteContext · type · L34-L41 — type HostedRouteContext = { identity: Awaited<ReturnType<typeof authAdapter.authenticate>>; workspaceStore: ReturnType<typeof hostedWorkspaceStoreForTenant>; domainStore: ReturnType<typeof hostedDomainStoreForTenant>; correlationId: string; version: string; isVersioned: boolean; };
- hostedIdentity · function · L43-L58 — async function hostedIdentity(request: Request)
- hostedInfrastructureError · function · L60-L76 — function hostedInfrastructureError(error: unknown): NextResponse | null
- formatHostedError · function · L78-L207 — function formatHostedError( error: unknown, correlationId: string, version: string = DEFAULT_API_VERSION, isVersioned: boolean = true ): NextResponse
- hostedError · function · L209-L246 — function hostedError(error: unknown): NextResponse
- executeHostedRoute · function · L248-L333 — async function executeHostedRoute( request: Request, handler: (context: HostedRouteContext) => Promise<NextResponse | Response> ): Promise<NextResponse | Response>
- errorMessages · function · L335-L343 — function errorMessages(error: unknown): string[]
