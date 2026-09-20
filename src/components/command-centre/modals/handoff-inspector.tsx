import type { Handoff } from "@/types/handoff";

export function HandoffInspector({
  selectedHandoff,
  handoffTitle,
  setHandoffTitle,
  handoffDecisions,
  setHandoffDecisions,
  handoffBlockers,
  setHandoffBlockers,
  handoffNextActions,
  setHandoffNextActions,
  handoffStatus,
  onClose,
  onSaveDraft,
  onFinalize,
}: {
  selectedHandoff: Handoff;
  handoffTitle: string;
  setHandoffTitle: (value: string) => void;
  handoffDecisions: string;
  setHandoffDecisions: (value: string) => void;
  handoffBlockers: string;
  setHandoffBlockers: (value: string) => void;
  handoffNextActions: string;
  setHandoffNextActions: (value: string) => void;
  handoffStatus: string | null;
  onClose: () => void;
  onSaveDraft: () => void;
  onFinalize: () => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Session Handoff Inspector">
      <div className="inspector-header">
        <div>
          <span className="tiny">session handoff / {selectedHandoff.status}</span>
          <h3>{selectedHandoff.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close handoff inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <p className="inspector-line">
        Repository: <code>{selectedHandoff.snapshot.repositoryContext.name}</code>
      </p>
      <p className="inspector-line">
        Branch: <code>{selectedHandoff.snapshot.branch ?? "detached HEAD"}</code>
      </p>
      <p className="inspector-line">
        Changed files: <code>{selectedHandoff.snapshot.changedFiles.length}</code>
      </p>
      <p className="inspector-line">
        Captured records:{" "}
        <code>
          {selectedHandoff.snapshot.workItems.length} work items /{" "}
          {selectedHandoff.snapshot.artifacts.length} artifacts /{" "}
          {selectedHandoff.snapshot.skillRuns.length} skill runs
        </code>
      </p>
      {selectedHandoff.status === "draft" ? (
        <div className="handoff-inspector-form">
          <input
            aria-label="Edit handoff title"
            value={handoffTitle}
            onChange={(event) => setHandoffTitle(event.target.value)}
          />
          <textarea
            aria-label="Edit handoff decisions"
            value={handoffDecisions}
            onChange={(event) => setHandoffDecisions(event.target.value)}
          />
          <textarea
            aria-label="Edit handoff blockers"
            value={handoffBlockers}
            onChange={(event) => setHandoffBlockers(event.target.value)}
          />
          <textarea
            aria-label="Edit handoff next actions"
            value={handoffNextActions}
            onChange={(event) => setHandoffNextActions(event.target.value)}
          />
          <div className="inspector-actions">
            <button className="outline-button" type="button" onClick={onSaveDraft}>
              Save Draft
            </button>
            <button className="outline-button" type="button" onClick={onFinalize}>
              Finalize Handoff
            </button>
          </div>
        </div>
      ) : (
        <p className="inspector-status">
          Immutable Artifact: <code>{selectedHandoff.artifactId}</code>
        </p>
      )}
      {handoffStatus ? (
        <p className="inspector-status" role="status">
          {handoffStatus}
        </p>
      ) : null}
    </aside>
  );
}
