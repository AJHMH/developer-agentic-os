import type { IncomingSignal, IncomingSignalStatus } from "@/types/incoming-signal";
import type { SignalTriageAction } from "@/types/signal-triage";
import type { WorkItem } from "@/types/work-item";
import type { SkillCommand } from "@/types/skill";

export function SignalInspector({
  selectedSignal,
  onClose,
  workItems,
  skills,
  triageTargetId,
  setTriageTargetId,
  signalTriageStatus,
  onUpdateStatus,
  onTriageSignal,
}: {
  selectedSignal: IncomingSignal;
  onClose: () => void;
  workItems: WorkItem[];
  skills: SkillCommand[];
  triageTargetId: string;
  setTriageTargetId: (value: string) => void;
  signalTriageStatus: string | null;
  onUpdateStatus: (signal: IncomingSignal, status: IncomingSignalStatus) => void;
  onTriageSignal: (signal: IncomingSignal, action: SignalTriageAction) => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Agent Inbox Inspector">
      <div className="inspector-header">
        <div>
          <span className="tiny">
            {selectedSignal.source} / {selectedSignal.status}
          </span>
          <h3>{selectedSignal.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close signal inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <p className="inspector-line">
        Repository Context ID: <code>{selectedSignal.repositoryId}</code>
      </p>
      <p className="inspector-line">
        Source ID: <code>{selectedSignal.sourceId ?? "none"}</code>
      </p>
      <p className="inspector-line">
        Received: <code>{new Date(selectedSignal.createdAt).toLocaleString()}</code>
      </p>
      <p className="inspector-line">
        Body: <code>{selectedSignal.body || "none"}</code>
      </p>
      <div className="inspector-actions">
        {(["triaged", "snoozed", "dismissed", "new"] as const)
          .filter((status) => status !== selectedSignal.status)
          .map((status) => (
            <button
              className="outline-button"
              key={status}
              type="button"
              onClick={() => onUpdateStatus(selectedSignal, status)}
            >
              {status}
            </button>
          ))}
      </div>
      <div className="signal-triage-actions">
        <span className="tiny">Triage actions</span>
        <button
          className="outline-button"
          type="button"
          onClick={() => onTriageSignal(selectedSignal, { action: "create_work_item" })}
        >
          Create Work Item
        </button>
        {workItems.length ? (
          <>
            <select
              aria-label="Existing work item for signal"
              value={triageTargetId || workItems[0].id}
              onChange={(event) => setTriageTargetId(event.target.value)}
            >
              {workItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              className="outline-button"
              type="button"
              onClick={() =>
                onTriageSignal(selectedSignal, {
                  action: "attach_work_item",
                  workItemId: triageTargetId || workItems[0].id,
                })
              }
            >
              Attach Work Item
            </button>
          </>
        ) : null}
        {skills.some((skill) => skill.kind === "built-in" && skill.inputs.length === 0) ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => {
              const skill = skills.find(
                (item) => item.kind === "built-in" && item.inputs.length === 0
              );
              if (skill)
                onTriageSignal(selectedSignal, {
                  action: "invoke_skill",
                  skillId: skill.id,
                });
            }}
          >
            Run Skill
          </button>
        ) : null}
        <button
          className="outline-button"
          type="button"
          onClick={() =>
            onTriageSignal(selectedSignal, {
              action: "create_artifact",
              name: selectedSignal.title,
              type: "signal_triage",
              content: selectedSignal.body,
            })
          }
        >
          Create Artifact
        </button>
        <button
          className="outline-button"
          type="button"
          onClick={() => onTriageSignal(selectedSignal, { action: "snooze" })}
        >
          Snooze
        </button>
        <button
          className="outline-button"
          type="button"
          onClick={() => onTriageSignal(selectedSignal, { action: "dismiss" })}
        >
          Dismiss
        </button>
      </div>
      {signalTriageStatus ? (
        <p className="inspector-status" role="status">
          {signalTriageStatus}
        </p>
      ) : null}
    </aside>
  );
}
