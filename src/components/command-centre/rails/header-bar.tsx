import {
  Info,
  LayoutGrid,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { GitHubOperations } from "@/types/github";
import type { VercelOperations } from "@/types/vercel";
import type { DashboardData } from "../types";
import { AuthControls } from "../auth-controls";

export function HeaderBar({
  leftRailOpen,
  setLeftRailOpen,
  rightRailOpen,
  setRightRailOpen,
  integrationOpen,
  setIntegrationOpen,
  onOpenLayout,
  dashboard,
  dashboardLoading,
  dashboardError,
  actionStatus,
  githubOperations,
  githubOperationsLoading,
  vercelOperations,
  vercelOperationsLoading,
  onRefreshIntegrations,
}: {
  leftRailOpen: boolean;
  setLeftRailOpen: (updater: (open: boolean) => boolean) => void;
  rightRailOpen: boolean;
  setRightRailOpen: (updater: (open: boolean) => boolean) => void;
  integrationOpen: boolean;
  setIntegrationOpen: (updater: (open: boolean) => boolean) => void;
  onOpenLayout: () => void;
  dashboard: DashboardData;
  dashboardLoading: boolean;
  dashboardError: string | null;
  actionStatus: string | null;
  githubOperations: GitHubOperations | null;
  githubOperationsLoading: boolean;
  vercelOperations: VercelOperations | null;
  vercelOperationsLoading: boolean;
  onRefreshIntegrations: () => void;
}) {
  return (
    <header className="brand">
      <div className="brand-mark">
        <span className="hex-mark" aria-hidden="true" />
        <h1>
          Developer <span>Agentic OS</span>
        </h1>
      </div>
      <p className="subtitle">Jay E | Developer Workspace</p>
      <nav className="toolbar" aria-label="Workspace controls">
        <AuthControls />
        <button type="button" aria-label="Search">
          <Search size={16} />
        </button>
        <button type="button" aria-label="Apps">
          <LayoutGrid size={16} />
        </button>
        <button
          type="button"
          aria-label="Integration status"
          onClick={() => setIntegrationOpen((open) => !open)}
        >
          <Info size={16} />
        </button>
        <button
          type="button"
          aria-label={`${leftRailOpen ? "Collapse" : "Expand"} left rail`}
          onClick={() => setLeftRailOpen((open) => !open)}
        >
          <PanelLeftClose size={16} />
        </button>
        <button
          type="button"
          aria-label={`${rightRailOpen ? "Collapse" : "Expand"} right rail`}
          onClick={() => setRightRailOpen((open) => !open)}
        >
          <PanelRightClose size={16} />
        </button>
        <button type="button" aria-label="Layout" onClick={onOpenLayout}>
          <SlidersHorizontal size={16} />
        </button>
      </nav>
      {integrationOpen ? (
        <div className="integration-popover" role="status" aria-label="Integration status">
          <div className="integration-popover-heading">
            <span>Operations health</span>
            <button
              type="button"
              aria-label="Refresh integration status"
              title="Refresh integration status"
              onClick={onRefreshIntegrations}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {dashboardLoading ? (
            <span className="dashboard-placeholder">Loading integrations...</span>
          ) : null}
          {dashboard.integrations.map((integration) => (
            <div className="integration-row" key={integration.id}>
              <div>
                <span>{integration.name}</span>
                <small>{integration.setup ?? integration.message}</small>
              </div>
              <b className={`integration-status ${integration.status}`}>{integration.status}</b>
            </div>
          ))}
          <div className="github-operations" aria-label="GitHub operations">
            <strong>GitHub operations</strong>
            {githubOperationsLoading ? (
              <span className="dashboard-placeholder">Checking GitHub...</span>
            ) : null}
            {!githubOperationsLoading && githubOperations ? (
              <>
                <span className={`integration-status ${githubOperations.status}`}>
                  {githubOperations.message}
                </span>
                <span>
                  Issues: {githubOperations.issues.length} | PRs:{" "}
                  {githubOperations.pullRequests.length} | Actions:{" "}
                  {githubOperations.actions.length}
                </span>
                <span>Merge status: {githubOperations.mergeStatus.state}</span>
                {githubOperations.issues.slice(0, 3).map((issue) => (
                  <a key={issue.number} href={issue.url} target="_blank" rel="noreferrer">
                    Issue #{issue.number}: {issue.title}
                  </a>
                ))}
                {githubOperations.pullRequests.slice(0, 3).map((pullRequest) => (
                  <a
                    key={pullRequest.number}
                    href={pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PR #{pullRequest.number}: {pullRequest.title} ({pullRequest.mergeable})
                  </a>
                ))}
                {githubOperations.actions.slice(0, 3).map((action) => (
                  <a key={action.id} href={action.url} target="_blank" rel="noreferrer">
                    Action: {action.name} ({action.conclusion ?? action.status})
                  </a>
                ))}
              </>
            ) : null}
          </div>
          <div className="github-operations" aria-label="Vercel operations">
            <strong>Vercel operations</strong>
            {vercelOperationsLoading ? (
              <span className="dashboard-placeholder">Checking Vercel...</span>
            ) : null}
            {!vercelOperationsLoading && vercelOperations ? (
              <>
                <span className={`integration-status ${vercelOperations.status}`}>
                  {vercelOperations.message}
                </span>
                <span>Deployments: {vercelOperations.deployments.length}</span>
                {vercelOperations.deployments.slice(0, 3).map((deployment) => (
                  <span key={deployment.id} className="vercel-deployment">
                    <span>
                      {deployment.name} ({deployment.state})
                    </span>
                    <span>
                      <a href={deployment.buildLogUrl} target="_blank" rel="noreferrer">
                        Build logs
                      </a>{" "}
                      <a href={deployment.runtimeLogUrl} target="_blank" rel="noreferrer">
                        Runtime logs
                      </a>
                    </span>
                  </span>
                ))}
              </>
            ) : null}
          </div>
          {!dashboardLoading && dashboard.integrations.length === 0 ? (
            <span className="dashboard-placeholder">No integration status available.</span>
          ) : null}
        </div>
      ) : null}
      {dashboardLoading ? <p className="dashboard-banner">Syncing workspace data...</p> : null}
      {dashboardError ? <p className="dashboard-banner error">{dashboardError}</p> : null}
      {actionStatus ? (
        <p className="dashboard-banner" role="status">
          {actionStatus}
        </p>
      ) : null}
    </header>
  );
}
