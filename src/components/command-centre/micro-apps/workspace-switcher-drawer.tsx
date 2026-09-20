import type { WorkspaceData } from "../types";

export function WorkspaceSwitcherDrawer({
  workspace,
  workspaceLoading,
  workspaceError,
  onSwitchRepository,
}: {
  workspace: WorkspaceData | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  onSwitchRepository: (id: string) => void;
}) {
  return (
    <section
      className="workspace-switcher-detail"
      id="workspace-switcher"
      role="region"
      aria-label="Workspace Switcher"
    >
      <div className="workspace-switcher-header">
        <span className="tiny">Workspace Switcher</span>
      </div>
      {workspaceLoading ? <p className="dashboard-placeholder">Loading repositories...</p> : null}
      {workspaceError ? <p className="dashboard-banner error">{workspaceError}</p> : null}
      {workspace ? (
        <div className="repository-list" role="list" aria-label="Registered repositories">
          {workspace.repositories.map((repository) => (
            <button
              className={`repository-option ${repository.id === workspace.context.id ? "active" : ""}`}
              key={repository.id}
              type="button"
              aria-pressed={repository.id === workspace.context.id}
              onClick={() => onSwitchRepository(repository.id)}
            >
              <span className="repository-main">
                <strong>{repository.name}</strong>
                <small>
                  {repository.git.available
                    ? (repository.git.currentBranch ?? "detached HEAD")
                    : "Git unavailable"}
                </small>
              </span>
              <span className="repository-meta">
                <span
                  className={`git-indicator ${repository.git.available ? "connected" : "unavailable"}`}
                  title={repository.git.message}
                  aria-label={repository.git.available ? "Git available" : "Git unavailable"}
                />
                <small>
                  {repository.git.available
                    ? `${repository.git.recentCommits.length} recent`
                    : "No activity"}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {workspace?.repositories.length === 0 ? (
        <p className="dashboard-placeholder">No registered repositories.</p>
      ) : null}
    </section>
  );
}
