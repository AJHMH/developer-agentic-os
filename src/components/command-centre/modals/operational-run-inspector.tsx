import type { AutomationRun, OperationalAuditRecord } from "@/types/operational";
import { providerActionForRun } from "../utils";

export function OperationalRunInspector({
  selectedOperationalRun,
  selectedOperationalAudit,
  inspectorStatus,
  onClose,
  onUpdateRun,
  onInvokeAction,
}: {
  selectedOperationalRun: AutomationRun;
  selectedOperationalAudit: OperationalAuditRecord | null;
  inspectorStatus: string | null;
  onClose: () => void;
  onUpdateRun: (run: AutomationRun, action: "approve" | "pause" | "resume" | "cancel") => void;
  onInvokeAction: (run: AutomationRun) => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Operational Run Inspector">
      <div className="inspector-header">
        <div>
          <span className="tiny">operational run / {selectedOperationalRun.status}</span>
          <h3>Automation run</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close operational run inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <p className="inspector-line">
        Run ID: <code>{selectedOperationalRun.id}</code>
      </p>
      <p className="inspector-line">
        Policy: <code>{selectedOperationalRun.policyId}</code>
      </p>
      <p className="inspector-line">
        Trigger: <code>{selectedOperationalRun.trigger}</code>
      </p>
      <p className="inspector-line">
        Input: <code>{JSON.stringify(selectedOperationalRun.input)}</code>
      </p>
      {selectedOperationalRun.error ? (
        <p className="inspector-line">
          Error: <code>{selectedOperationalRun.error}</code>
        </p>
      ) : null}
      <div className="inspector-actions">
        {selectedOperationalRun.status === "awaiting_approval" ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onUpdateRun(selectedOperationalRun, "approve")}
          >
            Approve Run
          </button>
        ) : null}
        {selectedOperationalRun.status === "queued" &&
        providerActionForRun(selectedOperationalRun) ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onInvokeAction(selectedOperationalRun)}
          >
            {providerActionForRun(selectedOperationalRun) === "github-rerun"
              ? "Rerun GitHub Action"
              : "Redeploy on Vercel"}
          </button>
        ) : null}
        {selectedOperationalRun.status === "running" ||
        selectedOperationalRun.status === "queued" ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onUpdateRun(selectedOperationalRun, "pause")}
          >
            Pause
          </button>
        ) : null}
        {selectedOperationalRun.status === "paused" ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onUpdateRun(selectedOperationalRun, "resume")}
          >
            Resume
          </button>
        ) : null}
        {!["succeeded", "failed", "cancelled", "missed", "interrupted"].includes(
          selectedOperationalRun.status
        ) ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onUpdateRun(selectedOperationalRun, "cancel")}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {selectedOperationalAudit ? (
        <div className="work-history">
          <span className="tiny">Audit result</span>
          <p className="inspector-line">
            Action: <code>{selectedOperationalAudit.action}</code>
          </p>
          <p className="inspector-line">
            Recorded: <code>{new Date(selectedOperationalAudit.recordedAt).toLocaleString()}</code>
          </p>
          <pre className="inspector-content">
            {JSON.stringify(selectedOperationalAudit.response, null, 2)}
          </pre>
        </div>
      ) : null}
      {inspectorStatus ? (
        <p className="inspector-status" role="status">
          {inspectorStatus}
        </p>
      ) : null}
    </aside>
  );
}
