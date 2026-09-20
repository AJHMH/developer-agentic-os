import {
  Archive,
  CheckCircle2,
  CircleDotDashed,
  Inbox,
  Mail,
  MailCheck,
  Play,
  Plus,
  Settings,
  Zap,
} from "lucide-react";
import type { WorkItem, WorkItemPriority, WorkItemStatus } from "@/types/work-item";
import type {
  IncomingSignal,
  IncomingSignalSource,
  IncomingSignalStatus,
} from "@/types/incoming-signal";
import type { AutomationRun, OperationalEvent, OperationalIncident } from "@/types/operational";
import type { SkillCommand } from "@/types/skill";
import type { ClientGraphNode, DashboardData, LayoutState, WorkspaceData } from "../types";
import { formatFocusDate, formatRoutineTime, iconForSkill, resizableStyle } from "../utils";
import { ModuleHeading, OutlineButton } from "../common-ui";

export function RightRail({
  layout,
  resizeRef,
  markResizeStart,
  workspace,
  dashboard,
  dashboardLoading,
  workItems,
  workItemTitle,
  setWorkItemTitle,
  workItemNotes,
  setWorkItemNotes,
  workItemDueAt,
  setWorkItemDueAt,
  workItemReferences,
  setWorkItemReferences,
  workItemPriority,
  setWorkItemPriority,
  workItemRepositoryFilter,
  setWorkItemRepositoryFilter,
  workItemStatusFilter,
  setWorkItemStatusFilter,
  onCreateWorkItem,
  onSelectWorkItem,
  focusBoardOpen,
  globalOperationalPaused,
  onToggleGlobalOperationalPause,
  onInspectOperationalIncident,
  onInspectOperationalRun,
  onInspectNode,
  onRunSkill,
  onRunRoutine,
  signals,
  signalTitle,
  setSignalTitle,
  signalBody,
  setSignalBody,
  signalSource,
  setSignalSource,
  signalSourceFilter,
  setSignalSourceFilter,
  signalStatusFilter,
  setSignalStatusFilter,
  onCreateSignal,
  onSelectSignal,
  onConfigureSkill,
  onControlExecutor,
}: {
  layout: LayoutState;
  resizeRef: (id: string) => (node: HTMLElement | null) => void;
  markResizeStart: (id: string, element: HTMLElement) => void;
  workspace: WorkspaceData | null;
  dashboard: DashboardData;
  dashboardLoading: boolean;
  workItems: WorkItem[];
  workItemTitle: string;
  setWorkItemTitle: (value: string) => void;
  workItemNotes: string;
  setWorkItemNotes: (value: string) => void;
  workItemDueAt: string;
  setWorkItemDueAt: (value: string) => void;
  workItemReferences: string;
  setWorkItemReferences: (value: string) => void;
  workItemPriority: WorkItemPriority;
  setWorkItemPriority: (value: WorkItemPriority) => void;
  workItemRepositoryFilter: string;
  setWorkItemRepositoryFilter: (value: string) => void;
  workItemStatusFilter: WorkItemStatus | "all";
  setWorkItemStatusFilter: (value: WorkItemStatus | "all") => void;
  onCreateWorkItem: (event: React.FormEvent<HTMLFormElement>) => void;
  onSelectWorkItem: (item: WorkItem) => void;
  focusBoardOpen: boolean;
  globalOperationalPaused: boolean;
  onToggleGlobalOperationalPause: () => void;
  onInspectOperationalIncident: (
    incident: OperationalIncident & { events: OperationalEvent[] }
  ) => void;
  onInspectOperationalRun: (run: AutomationRun) => void;
  onInspectNode: (node: ClientGraphNode) => void;
  onRunSkill: (skillId: string) => void;
  onRunRoutine: (routineId: string) => void;
  signals: IncomingSignal[];
  signalTitle: string;
  setSignalTitle: (value: string) => void;
  signalBody: string;
  setSignalBody: (value: string) => void;
  signalSource: IncomingSignalSource;
  setSignalSource: (value: IncomingSignalSource) => void;
  signalSourceFilter: IncomingSignalSource | "all";
  setSignalSourceFilter: (value: IncomingSignalSource | "all") => void;
  signalStatusFilter: IncomingSignalStatus | "all";
  setSignalStatusFilter: (value: IncomingSignalStatus | "all") => void;
  onCreateSignal: (event: React.FormEvent<HTMLFormElement>) => void;
  onSelectSignal: (signal: IncomingSignal) => void;
  onConfigureSkill: (skill: SkillCommand) => void;
  onControlExecutor: (action: "start" | "stop" | "trigger") => void;
}) {
  return (
    <aside className="right-rail" aria-label="Agent Inbox, Email, skills, and routines">
      <section className="module work-queue-module" aria-label="Work Queue">
        <ModuleHeading
          icon={CheckCircle2}
          title="Work Queue"
          action={<span className="tiny">{workItems.length} visible</span>}
        />
        <form className="work-item-capture" onSubmit={onCreateWorkItem}>
          <input
            aria-label="Work item title"
            placeholder="Capture a work item"
            value={workItemTitle}
            onChange={(event) => setWorkItemTitle(event.target.value)}
          />
          <textarea
            aria-label="Work item notes"
            placeholder="Notes (optional)"
            value={workItemNotes}
            onChange={(event) => setWorkItemNotes(event.target.value)}
          />
          <input
            aria-label="Work item due date"
            type="datetime-local"
            value={workItemDueAt}
            onChange={(event) => setWorkItemDueAt(event.target.value)}
          />
          <textarea
            aria-label="Work item context references"
            placeholder="References: file:path or skill:id (one per line)"
            value={workItemReferences}
            onChange={(event) => setWorkItemReferences(event.target.value)}
          />
          <div className="work-item-capture-row">
            <select
              aria-label="Work item priority"
              value={workItemPriority}
              onChange={(event) => setWorkItemPriority(event.target.value as WorkItemPriority)}
            >
              {(["low", "normal", "high", "urgent"] as const).map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
            <button className="outline-button" type="submit">
              <Plus size={12} aria-hidden="true" /> Capture
            </button>
          </div>
        </form>
        <div className="work-queue-filters">
          <select
            aria-label="Filter work items by repository"
            value={workItemRepositoryFilter}
            onChange={(event) => setWorkItemRepositoryFilter(event.target.value)}
          >
            <option value="active">Active repository</option>
            <option value="all">All repositories</option>
            {workspace?.repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter work items by status"
            value={workItemStatusFilter}
            onChange={(event) =>
              setWorkItemStatusFilter(event.target.value as WorkItemStatus | "all")
            }
          >
            <option value="all">All statuses</option>
            {(["open", "in_progress", "blocked", "completed"] as const).map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="work-item-list" aria-label="Work items">
          {workItems.length === 0 ? (
            <p className="dashboard-placeholder">No work items in this view.</p>
          ) : null}
          {workItems.map((item) => (
            <button
              className={`work-item-row ${item.status}`}
              key={item.id}
              type="button"
              onClick={() => onSelectWorkItem(item)}
            >
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.priority} / {item.status.replace("_", " ")}
                </small>
              </span>
              {item.status === "completed" ? (
                <CheckCircle2 size={14} aria-label="Completed" />
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {focusBoardOpen ? (
        <section className="module focus-board-module" aria-label="Today and Focus Board">
          <ModuleHeading
            icon={CheckCircle2}
            title="Today / Focus Board"
            action={
              <span className="tiny">{workspace?.context.name ?? "selected repository"}</span>
            }
          />
          {dashboardLoading && !dashboard.focusBoard ? (
            <p className="dashboard-placeholder">Loading today...</p>
          ) : null}
          {!dashboardLoading && !dashboard.focusBoard ? (
            <p className="dashboard-placeholder">Focus Board unavailable.</p>
          ) : null}
          {dashboard.focusBoard ? (
            <>
              <div className="focus-board-summary" aria-label="Focus Board summary">
                <span>
                  <strong>{dashboard.focusBoard.workItems.length}</strong> active
                </span>
                <span>
                  <strong>{dashboard.focusBoard.dueWorkItems.length}</strong> due
                </span>
                <span>
                  <strong>{dashboard.focusBoard.blockedWorkItems.length}</strong> blocked
                </span>
                <span>
                  <strong>
                    {dashboard.focusBoard.failedSkillRuns.length +
                      dashboard.focusBoard.failedRoutineExecutions.length}
                  </strong>{" "}
                  failed
                </span>
                <span>
                  <strong>{dashboard.focusBoard.operationalIncidents.length}</strong> incidents
                </span>
                <span>
                  <strong>{dashboard.focusBoard.operationalRuns.length}</strong> automation
                </span>
              </div>
              <div className="focus-board-section">
                <span className="tiny">Attention now</span>
                {dashboard.focusBoard.workItems.length === 0 ? (
                  <p className="dashboard-placeholder">No active work items.</p>
                ) : (
                  dashboard.focusBoard.workItems.map((item) => (
                    <div className={`focus-board-row ${item.attention}`} key={item.id}>
                      <button
                        type="button"
                        className="focus-board-record"
                        onClick={() => onSelectWorkItem(item)}
                      >
                        <strong>{item.title}</strong>
                        <small>
                          {item.attention.replace("_", " ")}{" "}
                          {item.dueAt ? ` / due ${formatFocusDate(item.dueAt)}` : ""}
                        </small>
                      </button>
                      <span className="focus-board-priority">{item.priority}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="focus-board-section">
                <span className="tiny">
                  Operational attention{" "}
                  <button
                    className="outline-button"
                    type="button"
                    onClick={onToggleGlobalOperationalPause}
                  >
                    {globalOperationalPaused ? "Resume all" : "Pause all"}
                  </button>
                </span>
                {dashboard.focusBoard.operationalIncidents.length === 0 &&
                dashboard.focusBoard.operationalRuns.length === 0 ? (
                  <p className="dashboard-placeholder">No operational attention.</p>
                ) : null}
                {dashboard.focusBoard.operationalIncidents.map((incident) => (
                  <button
                    className="focus-board-failure"
                    key={incident.id}
                    type="button"
                    onClick={() => onInspectOperationalIncident(incident)}
                  >
                    <span>
                      <strong>{incident.title}</strong>
                      <small>
                        {incident.providers.join(", ")} / {incident.events.length} event(s)
                      </small>
                    </span>
                    <span className="focus-board-priority">incident</span>
                  </button>
                ))}
                {dashboard.focusBoard.operationalRuns.map((run) => (
                  <button
                    className="focus-board-failure"
                    data-run-id={run.id}
                    key={run.id}
                    type="button"
                    onClick={() => onInspectOperationalRun(run)}
                  >
                    <span>
                      <strong>Automation run</strong>
                      <small>
                        {run.status.replace("_", " ")}
                        {run.error ? ` / ${run.error}` : ""}
                      </small>
                    </span>
                    <span className="focus-board-priority">{run.retryCount} retries</span>
                  </button>
                ))}
              </div>
              <div className="focus-board-section">
                <span className="tiny">Recent artifacts</span>
                {dashboard.focusBoard.recentArtifacts.length === 0 ? (
                  <p className="dashboard-placeholder">No recent artifacts.</p>
                ) : (
                  dashboard.focusBoard.recentArtifacts.slice(0, 4).map((artifact) => (
                    <button
                      className="focus-board-link"
                      type="button"
                      key={artifact.id}
                      onClick={() =>
                        onInspectNode({
                          id: `artifact:${artifact.id}`,
                          type: "artifact",
                          label: artifact.name,
                          metadata: {
                            artifactType: artifact.type,
                            createdAt: artifact.createdAt,
                          },
                        })
                      }
                    >
                      <Archive size={13} aria-hidden="true" />
                      <span>{artifact.name}</span>
                      <small>{formatFocusDate(artifact.createdAt)}</small>
                    </button>
                  ))
                )}
              </div>
              <div className="focus-board-section">
                <span className="tiny">Failed workflows</span>
                {dashboard.focusBoard.failedSkillRuns.length === 0 &&
                dashboard.focusBoard.failedRoutineExecutions.length === 0 ? (
                  <p className="dashboard-placeholder">No failed workflows.</p>
                ) : null}
                {dashboard.focusBoard.failedSkillRuns.map((run) => (
                  <div className="focus-board-failure" key={run.id}>
                    <span>
                      <strong>
                        {dashboard.skills.find((skill) => skill.id === run.skillId)?.command ??
                          run.skillId}
                      </strong>
                      <small>{run.error ?? "Skill failed"}</small>
                    </span>
                    <button
                      className="icon-button run"
                      type="button"
                      aria-label={`Run ${dashboard.skills.find((skill) => skill.id === run.skillId)?.command ?? run.skillId}`}
                      onClick={() => onRunSkill(run.skillId)}
                    >
                      <Play size={13} />
                    </button>
                  </div>
                ))}
                {dashboard.focusBoard.failedRoutineExecutions.map((execution) => (
                  <div className="focus-board-failure" key={execution.id}>
                    <span>
                      <strong>{execution.routineName}</strong>
                      <small>{execution.error ?? "Routine failed"}</small>
                    </span>
                    <button
                      className="icon-button run"
                      type="button"
                      aria-label={`Run ${execution.routineName}`}
                      onClick={() => onRunRoutine(execution.routineId)}
                    >
                      <Play size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="module agent-inbox-module" aria-label="Agent Inbox">
        <ModuleHeading
          icon={Inbox}
          title="Agent Inbox"
          action={<span className="tiny">{signals.length} visible</span>}
        />
        <form className="signal-capture" onSubmit={onCreateSignal}>
          <input
            aria-label="Signal title"
            placeholder="Capture an incoming signal"
            value={signalTitle}
            onChange={(event) => setSignalTitle(event.target.value)}
          />
          <textarea
            aria-label="Signal body"
            placeholder="Signal details (optional)"
            value={signalBody}
            onChange={(event) => setSignalBody(event.target.value)}
          />
          <div className="signal-capture-row">
            <select
              aria-label="Signal source"
              value={signalSource}
              onChange={(event) => setSignalSource(event.target.value as IncomingSignalSource)}
            >
              <option value="manual">Manual note</option>
              <option value="email">Demo Email</option>
            </select>
            <button className="outline-button" type="submit">
              <Plus size={12} aria-hidden="true" /> Add signal
            </button>
          </div>
        </form>
        <div className="signal-filters">
          <select
            aria-label="Filter signals by source"
            value={signalSourceFilter}
            onChange={(event) =>
              setSignalSourceFilter(event.target.value as IncomingSignalSource | "all")
            }
          >
            <option value="all">All sources</option>
            <option value="manual">Manual</option>
            <option value="email">Email</option>
          </select>
          <select
            aria-label="Filter signals by status"
            value={signalStatusFilter}
            onChange={(event) =>
              setSignalStatusFilter(event.target.value as IncomingSignalStatus | "all")
            }
          >
            <option value="all">All statuses</option>
            {(["new", "snoozed", "dismissed", "triaged"] as const).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="signal-list" aria-label="Incoming signals">
          {signals.length === 0 ? (
            <p className="dashboard-placeholder">No signals in this view.</p>
          ) : null}
          {signals.map((signal) => (
            <button
              className={`signal-row ${signal.status}`}
              key={signal.id}
              type="button"
              onClick={() => onSelectSignal(signal)}
            >
              <span>
                <strong>{signal.title}</strong>
                <small>
                  {signal.source} / {signal.status}
                </small>
              </span>
              <span className="signal-marker" />
            </button>
          ))}
        </div>
      </section>

      <section
        className="module resizable-widget"
        data-resizable-id="email"
        ref={resizeRef("email")}
        style={resizableStyle("email", layout)}
        onPointerDown={(event) => markResizeStart("email", event.currentTarget)}
      >
        <ModuleHeading
          icon={Mail}
          title="Email"
          action={<span className="tiny">updated 5m ago</span>}
        />
        <div className="email-count">
          <strong>47</strong>
          <span>
            Emails
            <br />
            past 24h
          </span>
        </div>
        <div className="caption">Flagged - needs Jay</div>
        <div className="mail-list">
          <div className="mail-item">
            <MailCheck size={13} />
            <strong>Sponsorship proposal - AI dev tools brand</strong>
            <time>2h</time>
          </div>
          <div className="mail-item">
            <MailCheck size={13} />
            <strong>Enterprise plan inquiry - 40 seats</strong>
            <time>4h</time>
          </div>
          <div className="mail-item">
            <MailCheck size={13} />
            <strong>Partnership newsletter cross-promo</strong>
            <time>7h</time>
          </div>
        </div>
        <div className="mix-bar">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="mix-legend">
          <span>9 partners</span>
          <span>14 leads</span>
          <span>6 personal</span>
          <span>18 other</span>
        </div>
        <p className="sync">Synced 02:36 PM - team@developer.local</p>
      </section>

      <section
        className="module resizable-widget"
        data-resizable-id="skills-deck"
        ref={resizeRef("skills-deck")}
        style={resizableStyle("skills-deck", layout)}
        onPointerDown={(event) => markResizeStart("skills-deck", event.currentTarget)}
      >
        <ModuleHeading
          icon={Zap}
          title="Skills Deck"
          action={
            <OutlineButton>
              <Plus size={12} aria-hidden="true" /> Add Skill
            </OutlineButton>
          }
        />
        <div className="skills-grid">
          {dashboardLoading ? (
            <span className="dashboard-placeholder">Loading skills...</span>
          ) : null}
          {!dashboardLoading && dashboard.skills.length === 0 ? (
            <span className="dashboard-placeholder">No skills available.</span>
          ) : null}
          {dashboard.skills.map((skill) => {
            const Icon = iconForSkill(skill.id);
            return (
              <article
                className="skill-card resizable-widget"
                data-resizable-id={`skill-${skill.id}`}
                ref={resizeRef(`skill-${skill.id}`)}
                style={resizableStyle(`skill-${skill.id}`, layout)}
                onPointerDown={(event) => markResizeStart(`skill-${skill.id}`, event.currentTarget)}
                key={skill.id}
              >
                <div>
                  <Icon className="skill-icon" size={22} aria-hidden="true" />
                  <strong className="skill-title">{skill.command}</strong>
                  <span>
                    <b className={`model ${skill.model.toLowerCase()}`}>{skill.model}</b>{" "}
                    <span className="effort">{skill.effort}</span>
                  </span>
                </div>
                <div className="skill-actions">
                  <button
                    className="icon-button run"
                    type="button"
                    aria-label={`Run ${skill.command}`}
                    onClick={() => onRunSkill(skill.id)}
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Configure ${skill.command}`}
                    onClick={() => onConfigureSkill(skill)}
                  >
                    <Settings size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="module resizable-widget"
        data-resizable-id="routines"
        ref={resizeRef("routines")}
        style={resizableStyle("routines", layout)}
        onPointerDown={(event) => markResizeStart("routines", event.currentTarget)}
      >
        <ModuleHeading
          icon={CircleDotDashed}
          title="Routines"
          action={
            <span className="routine-controls">
              <span className="tiny">
                {dashboard.executor.running ? "background on" : "background off"}
              </span>
              <span className="routine-control-buttons">
                <button
                  className="outline-button"
                  type="button"
                  onClick={() => onControlExecutor(dashboard.executor.running ? "stop" : "start")}
                >
                  {dashboard.executor.running ? "Stop" : "Start"}
                </button>
                <button
                  className="outline-button"
                  type="button"
                  onClick={() => onControlExecutor("trigger")}
                >
                  Trigger
                </button>
              </span>
            </span>
          }
        />
        <div className="routine-table">
          <div className="routine-header">
            <span>Time</span>
            <span>Routine</span>
            <span>Status</span>
          </div>
          {dashboardLoading ? (
            <div className="dashboard-placeholder">Loading routines...</div>
          ) : null}
          {!dashboardLoading && dashboard.routines.length === 0 ? (
            <div className="dashboard-placeholder">No routines available.</div>
          ) : null}
          {dashboard.routines.map((routine) => (
            <div className={`routine-row ${routine.status}`} key={routine.id}>
              <span className="time-chip">{routine.scheduleLabel}</span>
              <span>
                <strong className="routine-name">
                  {routine.name}
                  <small className="routine-meta">
                    {routine.kind}{" "}
                    {routine.lastRunAt
                      ? `| last ${formatRoutineTime(routine.lastRunAt)}`
                      : "| not run"}{" "}
                    {routine.nextDueAt ? `| next ${formatRoutineTime(routine.nextDueAt)}` : ""}
                  </small>
                </strong>
              </span>
              <span className="routine-actions">
                <span className={`status ${routine.status === "next" ? "next" : ""}`}>
                  {routine.status}
                </span>
                {routine.kind === "built-in" ? (
                  <button
                    className="icon-button run"
                    type="button"
                    aria-label={`Run ${routine.name}`}
                    onClick={() => onRunRoutine(routine.id)}
                  >
                    <Play size={13} />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
