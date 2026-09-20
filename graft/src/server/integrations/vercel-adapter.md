# src/server/integrations/vercel-adapter.ts

- VercelFetch · type · L6-L6 — type VercelFetch = (input: string, init?: RequestInit) => Promise<Response>;
- VercelApiDeployment · type · L7-L14 — type VercelApiDeployment = { uid?: unknown; name?: unknown; url?: unknown; state?: unknown; created?: unknown; target?: unknown; };
- VercelAdapter · class · L16-L177 — class VercelAdapter
- constructor · method · L23-L33 — constructor( private readonly env: Record<string, string | undefined> = process.env, fetcher: VercelFetch = fetch as VercelFetch, private readonly repositoryRoot?: string )
- getOperations · method · L35-L83 — async getOperations(): Promise<VercelOperations>
- redeploy · method · L85-L128 — async redeploy( deploymentId: string, expectedProjectId?: string ): Promise<{ ok: boolean; status: number; response: Record<string, unknown> }>
- projectForContext · method · L130-L142 — private async projectForContext(): Promise<{ id: string | null; teamId: string | undefined }>
- request · method · L144-L165 — private async request<T>(path: string): Promise<T>
- empty · method · L167-L176 — private empty(status: VercelOperations["status"], message: string): VercelOperations
- responseBody · function · L179-L185 — async function responseBody(response: Response): Promise<unknown>
- VercelRequestError · class · L187-L191 — class VercelRequestError extends Error
- constructor · method · L188-L190 — constructor(readonly failure: VercelFailure)
- failureForResponse · function · L193-L204 — function failureForResponse(response: Response): VercelFailure
- toDeployment · function · L206-L220 — function toDeployment(deployment: VercelApiDeployment, projectId: string): VercelDeployment
- deploymentState · function · L222-L228 — function deploymentState(value: unknown): VercelDeployment["state"]
