import type { HostedState, HostedStateProvider } from "@/server/hosted-domain/hosted-domain-store";
import type {
  HostedWorkspaceState,
  HostedWorkspaceStateProvider,
} from "@/server/hosted-workspaces/hosted-workspace-store";
import { Pool } from "@neondatabase/serverless";
import { hostedDatabaseUrl } from "./neon-hosted-provider";

export type HostedMigrationStatus = {
  tenantId: string;
  source: string;
  target: string;
  version: number;
  state: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export interface HostedMigrationStatusStore {
  read(tenantId: string): Promise<HostedMigrationStatus | null>;
  write(status: HostedMigrationStatus): Promise<void>;
}

export type HostedMigrationInput = {
  tenantId: string;
  source: {
    state: HostedStateProvider;
    workspace: HostedWorkspaceStateProvider;
  };
  target: {
    state: HostedStateProvider;
    workspace: HostedWorkspaceStateProvider;
  };
  status: HostedMigrationStatusStore;
  sourceName: string;
  targetName: string;
  version: number;
  now?: () => string;
};

export type HostedMigrationResult = {
  status: HostedMigrationStatus;
  state: HostedState;
  workspace: HostedWorkspaceState;
  deployment?: Awaited<ReturnType<NonNullable<HostedStateProvider["readDeploymentState"]>>>;
};

export async function migrateHostedTenant(
  input: HostedMigrationInput
): Promise<HostedMigrationResult> {
  if (!input.tenantId.trim()) throw new Error("Hosted migration requires a tenant ID.");
  const now = input.now ?? (() => new Date().toISOString());
  const existing = await input.status.read(input.tenantId);
  if (existing?.state === "completed") {
    return {
      status: existing,
      state: await input.target.state.read(),
      workspace: await input.target.workspace.read(),
      deployment: input.target.state.readDeploymentState
        ? await input.target.state.readDeploymentState()
        : undefined,
    };
  }

  const running: HostedMigrationStatus = {
    tenantId: input.tenantId,
    source: input.sourceName,
    target: input.targetName,
    version: input.version,
    state: "running",
    startedAt: existing?.startedAt ?? now(),
  };
  await input.status.write(running);

  try {
    const state = await input.source.state.read();
    const workspace = await input.source.workspace.read();
    const deployment = input.source.state.readDeploymentState
      ? await input.source.state.readDeploymentState()
      : undefined;
    if (
      Boolean(input.source.state.readDeploymentState) !==
      Boolean(input.target.state.writeDeploymentState)
    )
      throw new Error("Hosted migration requires matching deployment providers.");
    const previousState = await input.target.state.read();
    const previousWorkspace = await input.target.workspace.read();
    const previousDeployment = input.target.state.readDeploymentState
      ? await input.target.state.readDeploymentState()
      : undefined;
    let stateWritten = false;
    let workspaceWritten = false;
    let deploymentWritten = false;
    const write = async () => {
      await input.target.state.write(state);
      stateWritten = true;
      await input.target.workspace.write(workspace);
      workspaceWritten = true;
      if (deployment && input.target.state.writeDeploymentState) {
        await input.target.state.writeDeploymentState(deployment);
        deploymentWritten = true;
      }
    };
    try {
      if (input.target.state.withMutationLock) await input.target.state.withMutationLock(write);
      else await write();
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      try {
        if (deploymentWritten && input.target.state.writeDeploymentState)
          await input.target.state.writeDeploymentState(
            previousDeployment ?? {
              vercelProject: null,
              vercelProjectHistory: [],
              githubRepositories: [],
            }
          );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        if (workspaceWritten) await input.target.workspace.write(previousWorkspace);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        if (stateWritten) await input.target.state.write(previousState);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      if (rollbackErrors.length) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; rollback also failed: ${rollbackErrors
            .map((rollbackError) =>
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            )
            .join("; ")}`,
          { cause: error }
        );
      }
      throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
    }
    const completed: HostedMigrationStatus = { ...running, state: "completed", completedAt: now() };
    await input.status.write(completed);
    return { status: completed, state, workspace, deployment };
  } catch (error) {
    const failed: HostedMigrationStatus = {
      ...running,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await input.status.write(failed);
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export class NeonHostedMigrationStatusStore implements HostedMigrationStatusStore {
  private readonly pool = new Pool({ connectionString: hostedDatabaseUrl() });
  private ready: Promise<void> | undefined;

  async read(tenantId: string): Promise<HostedMigrationStatus | null> {
    await this.ensureSchema();
    const result = await this.pool.query<HostedMigrationStatus>(
      `SELECT tenant_id AS "tenantId", source, target, version, state, started_at AS "startedAt",
        completed_at AS "completedAt", error
       FROM developer_agentic_os_migration_status WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] ?? null;
  }

  async write(status: HostedMigrationStatus): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO developer_agentic_os_migration_status
        (tenant_id, source, target, version, state, started_at, completed_at, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id) DO UPDATE SET source = EXCLUDED.source, target = EXCLUDED.target,
         version = EXCLUDED.version, state = EXCLUDED.state, started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at, error = EXCLUDED.error`,
      [
        status.tenantId,
        status.source,
        status.target,
        status.version,
        status.state,
        status.startedAt,
        status.completedAt ?? null,
        status.error ?? null,
      ]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private ensureSchema(): Promise<void> {
    return (this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS developer_agentic_os_migration_status (
        tenant_id text PRIMARY KEY,
        source text NOT NULL,
        target text NOT NULL,
        version integer NOT NULL,
        state text NOT NULL,
        started_at timestamptz NOT NULL,
        completed_at timestamptz,
        error text
      )`
      )
      .then(() => undefined));
  }
}
