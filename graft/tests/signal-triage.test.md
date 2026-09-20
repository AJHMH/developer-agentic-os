# tests/signal-triage.test.ts

- TriageResponse · type · L12-L21 — type TriageResponse = { signal: { status: string; sourceId?: string | null }; workItem?: { id: string; title: string; contextRefs: Array<{ kind: string; ref: string; label?: string }>; }; skillRun?: { status: string; artifactId: string }; artifact?: { provenance: { workflowRefs: Array<{ kind: string; ref: string }> } }; };
- readBody · function · L23-L25 — async function readBody(response: Response): Promise<TriageResponse>
- request · function · L27-L32 — function request(root: string, action: Record<string, unknown>): Request
