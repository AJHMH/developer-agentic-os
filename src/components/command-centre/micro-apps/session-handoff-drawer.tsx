import { ClipboardPen } from "lucide-react";
import type { Handoff } from "@/types/handoff";
import type { WorkspaceData } from "../types";

export function SessionHandoffDrawer({
  workspace,
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
}: {
  workspace: WorkspaceData | null;
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
}) {
  return (
    <section
      className="workspace-switcher-detail handoff-app"
      id="session-handoff"
      aria-label="Session Handoff"
    >
      <div className="handoff-app-header">
        <span className="tiny">{workspace?.context.name ?? "selected repository"}</span>
        <strong>Session Handoff</strong>
      </div>
      <form className="handoff-form" onSubmit={onCreateHandoff}>
        <input
          aria-label="Handoff title"
          placeholder="Handoff title"
          value={handoffTitle}
          onChange={(event) => setHandoffTitle(event.target.value)}
        />
        <textarea
          aria-label="Handoff decisions"
          placeholder="Decisions, one per line"
          value={handoffDecisions}
          onChange={(event) => setHandoffDecisions(event.target.value)}
        />
        <textarea
          aria-label="Handoff blockers"
          placeholder="Blockers, one per line"
          value={handoffBlockers}
          onChange={(event) => setHandoffBlockers(event.target.value)}
        />
        <textarea
          aria-label="Handoff next actions"
          placeholder="Next actions, one per line"
          value={handoffNextActions}
          onChange={(event) => setHandoffNextActions(event.target.value)}
        />
        <button className="outline-button" type="submit">
          <ClipboardPen size={12} aria-hidden="true" /> Create Draft
        </button>
      </form>
      <div className="handoff-list" aria-label="Handoff drafts">
        {handoffs.length === 0 ? (
          <p className="dashboard-placeholder">No handoffs for this repository.</p>
        ) : (
          handoffs.map((handoff) => (
            <button
              className="handoff-row"
              type="button"
              key={handoff.id}
              onClick={() => onSelectHandoff(handoff)}
            >
              <span>
                <strong>{handoff.title}</strong>
                <small>
                  {handoff.status} / {handoff.snapshot.branch ?? "detached HEAD"}
                </small>
              </span>
              <span className="tiny">{handoff.snapshot.changedFiles.length} files</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
