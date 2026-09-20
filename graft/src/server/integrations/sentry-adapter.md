# src/server/integrations/sentry-adapter.ts

- SentryHealthState · type · L4-L11 — type SentryHealthState = | "healthy" | "unconfigured" | "authentication" | "timeout" | "rate_limit" | "unavailable" | "unhealthy";
- SentryObservation · type · L12-L19 — type SentryObservation = { state: SentryHealthState; project: string | null; sourceId: string | null; title: string; observedAt: string; details: Record<string, unknown>; };
- SentryFetch · type · L21-L21 — type SentryFetch = (input: string, init?: RequestInit) => Promise<Response>;
- SentryIssue · type · L22-L30 — type SentryIssue = { id?: unknown; title?: unknown; culprit?: unknown; firstSeen?: unknown; lastSeen?: unknown; count?: unknown; level?: unknown; };
- SentryAdapter · class · L32-L149 — class SentryAdapter
- constructor · method · L33-L37 — constructor( private readonly env: Record<string, string | undefined> = process.env, private readonly fetcher: SentryFetch = fetch as SentryFetch, private readonly repositoryRoot?: string )
- getObservations · method · L39-L104 — async getObservations(): Promise<SentryObservation[]>
- failure · method · L106-L119 — private failure( state: SentryHealthState, project: string | null, title: string ): SentryObservation
- contextConfig · method · L121-L148 — private async contextConfig(): Promise<{ token?: string; organization?: string; project?: string; }>
- stringValue · function · L151-L153 — function stringValue(value: unknown): string | null
