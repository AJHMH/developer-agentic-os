# src/server/local-store/local-store-export.ts

- LocalStoreExport · type · L4-L8 — type LocalStoreExport = { repositories: Array<{ id: string; localPath: string; pathIdentity: string }>; records: Record<string, Array<Record<string, unknown>>>; relationships: Array<{ from: string; to: string; kind: string }>; };
- LocalWorkspace · type · L10-L10 — type LocalWorkspace = { repositories?: Array<{ id?: unknown; path?: unknown }> };
- LocalOperationalState · type · L11-L11 — type LocalOperationalState = { incidents?: unknown[]; runs?: unknown[]; audits?: unknown[] };
- ArtifactIndex · type · L12-L12 — type ArtifactIndex = { artifacts?: unknown[] };
- LocalStoreExportAdapter · interface · L14-L16 — interface LocalStoreExportAdapter
- DeterministicLocalStoreExportAdapter · class · L18-L46 — class DeterministicLocalStoreExportAdapter implements LocalStoreExportAdapter
- constructor · method · L19-L19 — constructor(private readonly root = process.cwd())
- export · method · L21-L45 — async export(): Promise<LocalStoreExport>
- toRecords · function · L48-L53 — function toRecords(value: unknown[] | undefined): Array<Record<string, unknown>>
