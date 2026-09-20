import { Archive, CalendarDays, Grip, Plus } from "lucide-react";
import type { Handoff } from "@/types/handoff";
import type {
  ClientGraph,
  ClientGraphNode,
  DashboardData,
  LayoutState,
  WorkspaceData,
} from "../types";
import { microApps } from "../types";
import { resizableStyle } from "../utils";
import { ModuleHeading, OutlineButton } from "../common-ui";
import { WorkspaceSwitcherDrawer } from "../micro-apps/workspace-switcher-drawer";
import { SessionHandoffDrawer } from "../micro-apps/session-handoff-drawer";
import { SecondBrainDrawer } from "../micro-apps/second-brain-drawer";

export function LeftRail({
  layout,
  resizeRef,
  markResizeStart,
  workspaceSwitcherOpen,
  setWorkspaceSwitcherOpen,
  focusBoardOpen,
  setFocusBoardOpen,
  secondBrainOpen,
  setSecondBrainOpen,
  secondBrainModalOpen,
  setSecondBrainModalOpen,
  secondBrainSearch,
  setSecondBrainSearch,
  secondBrainTypeFilter,
  setSecondBrainTypeFilter,
  filteredGraphNodes,
  selectedNode,
  handoffOpen,
  setHandoffOpen,
  workspace,
  workspaceLoading,
  workspaceError,
  onSwitchRepository,
  handoffs,
  handoffTitle,
  setHandoffTitle,
  handoffDecisions,
  setHandoffDecisions,
  handoffBlockers,
  setHandoffBlockers,
  handoffNextActions,
  setHandoffNextActions,
  onCreateHandoff,
  onSelectHandoff,
  graph,
  dashboard,
  dashboardLoading,
  onInspectNode,
  onRefreshSecondBrain,
}: {
  layout: LayoutState;
  resizeRef: (id: string) => (node: HTMLElement | null) => void;
  markResizeStart: (id: string, element: HTMLElement) => void;
  workspaceSwitcherOpen: boolean;
  setWorkspaceSwitcherOpen: (updater: (open: boolean) => boolean) => void;
  focusBoardOpen: boolean;
  setFocusBoardOpen: (updater: (open: boolean) => boolean) => void;
  secondBrainOpen: boolean;
  setSecondBrainOpen: (updater: (open: boolean) => boolean) => void;
  secondBrainModalOpen: boolean;
  setSecondBrainModalOpen: (open: boolean) => void;
  secondBrainSearch: string;
  setSecondBrainSearch: (value: string) => void;
  secondBrainTypeFilter: string;
  setSecondBrainTypeFilter: (value: string) => void;
  filteredGraphNodes: ClientGraphNode[];
  selectedNode: ClientGraphNode | null;
  handoffOpen: boolean;
  setHandoffOpen: (updater: (open: boolean) => boolean) => void;
  workspace: WorkspaceData | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  onSwitchRepository: (id: string) => void;
  handoffs: Handoff[];
  handoffTitle: string;
  setHandoffTitle: (value: string) => void;
  handoffDecisions: string;
  setHandoffDecisions: (value: string) => void;
  handoffBlockers: string;
  setHandoffBlockers: (value: string) => void;
  handoffNextActions: string;
  setHandoffNextActions: (value: string) => void;
  onCreateHandoff: (event: React.FormEvent<HTMLFormElement>) => void;
  onSelectHandoff: (handoff: Handoff) => void;
  graph: ClientGraph | null;
  dashboard: DashboardData;
  dashboardLoading: boolean;
  onInspectNode: (node: ClientGraphNode) => void;
  onRefreshSecondBrain: () => void;
}) {
  return (
    <aside className="rail" aria-label="Micro applications and calendar">
      <section
        className="module resizable-widget"
        data-resizable-id="micro-apps"
        ref={resizeRef("micro-apps")}
        style={resizableStyle("micro-apps", layout)}
        onPointerDown={(event) => markResizeStart("micro-apps", event.currentTarget)}
      >
        <ModuleHeading
          icon={Grip}
          title="Micro Apps"
          action={
            <OutlineButton>
              <Plus size={12} aria-hidden="true" /> Add App
            </OutlineButton>
          }
        />
        <div className="micro-list">
          {microApps.map(({ icon: Icon, title, description }) => {
            const isAppActive =
              (title === "Workspace Switcher" && workspaceSwitcherOpen) ||
              (title === "Today / Focus Board" && focusBoardOpen) ||
              (title === "Second Brain" && (secondBrainOpen || secondBrainModalOpen)) ||
              (title === "Session Handoff" && handoffOpen);
            return (
              <button
                className={`micro-app ${isAppActive ? "active" : ""}`}
                key={title}
                type="button"
                aria-label={`${title}: ${description}`}
                aria-expanded={
                  title === "Workspace Switcher"
                    ? workspaceSwitcherOpen
                    : title === "Today / Focus Board"
                      ? focusBoardOpen
                      : title === "Second Brain"
                        ? secondBrainOpen
                        : title === "Session Handoff"
                          ? handoffOpen
                          : undefined
                }
                onClick={
                  title === "Workspace Switcher"
                    ? () => setWorkspaceSwitcherOpen((open) => !open)
                    : title === "Today / Focus Board"
                      ? () => setFocusBoardOpen((open) => !open)
                      : title === "Second Brain"
                        ? () => setSecondBrainOpen((open) => !open)
                        : title === "Session Handoff"
                          ? () => setHandoffOpen((open) => !open)
                          : undefined
                }
              >
                <div className="app-icon">
                  <Icon size={14} aria-hidden="true" />
                </div>
                <div>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </div>
                <div className="signal-dots">---</div>
              </button>
            );
          })}
        </div>
        {workspaceSwitcherOpen ? (
          <WorkspaceSwitcherDrawer
            workspace={workspace}
            workspaceLoading={workspaceLoading}
            workspaceError={workspaceError}
            onSwitchRepository={onSwitchRepository}
          />
        ) : null}
        {handoffOpen ? (
          <SessionHandoffDrawer
            workspace={workspace}
            handoffs={handoffs}
            handoffTitle={handoffTitle}
            setHandoffTitle={setHandoffTitle}
            handoffDecisions={handoffDecisions}
            setHandoffDecisions={setHandoffDecisions}
            handoffBlockers={handoffBlockers}
            setHandoffBlockers={setHandoffBlockers}
            handoffNextActions={handoffNextActions}
            setHandoffNextActions={setHandoffNextActions}
            onCreateHandoff={onCreateHandoff}
            onSelectHandoff={onSelectHandoff}
          />
        ) : null}
        {secondBrainOpen ? (
          <SecondBrainDrawer
            workspace={workspace}
            graph={graph}
            secondBrainSearch={secondBrainSearch}
            setSecondBrainSearch={setSecondBrainSearch}
            secondBrainTypeFilter={secondBrainTypeFilter}
            setSecondBrainTypeFilter={setSecondBrainTypeFilter}
            filteredGraphNodes={filteredGraphNodes}
            selectedNode={selectedNode}
            onInspectNode={onInspectNode}
            onRefresh={onRefreshSecondBrain}
            onOpenModal={() => setSecondBrainModalOpen(true)}
          />
        ) : null}
      </section>

      <section
        className="module resizable-widget"
        data-resizable-id="calendar"
        ref={resizeRef("calendar")}
        style={resizableStyle("calendar", layout)}
        onPointerDown={(event) => markResizeStart("calendar", event.currentTarget)}
      >
        <ModuleHeading
          icon={CalendarDays}
          title="Calendar"
          action={<OutlineButton>Open Cal</OutlineButton>}
        />
        <div className="clock-card">
          <div className="clock-face" aria-hidden="true" />
          <div>
            <div className="date-row">WK34 | Aug 20 2026 (Thu)</div>
            <div className="main-time">02:32:43 pm</div>
            <div className="caption">Aest synced</div>
          </div>
        </div>
        <div className="tz-row">
          <div className="tz">
            <strong>09:32 pm</strong>
            <span>USA PT</span>
          </div>
          <div className="tz">
            <strong>12:32 am</strong>
            <span>USA ET</span>
          </div>
          <div className="tz">
            <strong>05:32 am</strong>
            <span>London</span>
          </div>
        </div>
        <div className="quarter-grid" aria-label="Quarter heatmap">
          {Array.from({ length: 56 }, (_, index) => (
            <span
              className={`q-cell ${index === 25 ? "done" : index > 42 || index % 17 === 0 ? "dim" : ""}`}
              key={index}
            />
          ))}
        </div>
        <div className="agenda">
          <div className="agenda-row">
            <strong>Team standup</strong>
            <time>3:30pm</time>
          </div>
          <div className="agenda-row">
            <strong>Partnership intro - Nordic SaaS</strong>
            <time>5:00pm</time>
          </div>
          <div className="agenda-row">
            <strong>Team meet - sprint review</strong>
            <time>6:30pm</time>
          </div>
        </div>
      </section>

      <section
        className="module resizable-widget"
        data-resizable-id="artifacts"
        ref={resizeRef("artifacts")}
        style={resizableStyle("artifacts", layout)}
        onPointerDown={(event) => markResizeStart("artifacts", event.currentTarget)}
      >
        <ModuleHeading
          icon={Archive}
          title="Artifacts"
          action={<span className="tiny">{dashboard.artifacts.length} recent</span>}
        />
        <div className="artifact-strip" aria-label="Recent artifact activity">
          {dashboardLoading ? (
            <span className="dashboard-placeholder">Loading artifacts...</span>
          ) : null}
          {!dashboardLoading && dashboard.artifacts.length === 0 ? (
            <span className="dashboard-placeholder">No artifacts yet.</span>
          ) : null}
          {dashboard.artifacts.map((artifact, index) => (
            <button
              className={`artifact-dot ${index % 3 === 0 ? "hot" : index % 3 === 1 ? "active" : ""}`}
              key={artifact.id}
              title={artifact.name}
              type="button"
              onClick={() =>
                onInspectNode({
                  id: `artifact:${artifact.id}`,
                  type: "artifact",
                  label: artifact.name,
                  metadata: { artifactType: artifact.type, createdAt: artifact.createdAt },
                })
              }
            >
              <span />
              <small>{artifact.name}</small>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
