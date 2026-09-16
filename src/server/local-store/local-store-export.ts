import { readJsonFile } from "./json-file";
import { getLocalStorePaths } from "./paths";

export type LocalStoreExport = {
  repositories: Array<{ id: string; localPath: string; pathIdentity: string }>;
  records: Record<string, Array<Record<string, unknown>>>;
  relationships: Array<{ from: string; to: string; kind: string }>;
};

type LocalWorkspace = { repositories?: Array<{ id?: unknown; path?: unknown }> };
type LocalOperationalState = { incidents?: unknown[]; runs?: unknown[]; audits?: unknown[] };
type ArtifactIndex = { artifacts?: unknown[] };

export interface LocalStoreExportAdapter {
  export(): Promise<LocalStoreExport>;
}

export class DeterministicLocalStoreExportAdapter implements LocalStoreExportAdapter {
  constructor(private readonly root = process.cwd()) {}

  async export(): Promise<LocalStoreExport> {
    const paths = getLocalStorePaths(this.root);
    const workspace = await readJsonFile<LocalWorkspace>(paths.workspace, {});
    const repositories = (workspace.repositories ?? []).flatMap((repository) => {
      if (typeof repository.id !== "string" || typeof repository.path !== "string") return [];
      return [{ id: repository.id, localPath: repository.path, pathIdentity: repository.id }];
    });
    const operational = await readJsonFile<LocalOperationalState>(paths.operational, {});
    const artifacts = await readJsonFile<ArtifactIndex>(`${paths.artifacts}/index.json`, {});
    return {
      repositories,
      records: {
        workItems: await readJsonFile<Array<Record<string, unknown>>>(paths.workItems, []),
        incomingSignals: await readJsonFile<Array<Record<string, unknown>>>(
          paths.incomingSignals,
          []
        ),
        incidents: toRecords(operational.incidents),
        automationRuns: toRecords(operational.runs),
        approvals: toRecords(operational.audits),
        artifacts: toRecords(artifacts.artifacts),
      },
      relationships: [],
    };
  }
}

function toRecords(value: unknown[] | undefined): Array<Record<string, unknown>> {
  return (value ?? []).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}
