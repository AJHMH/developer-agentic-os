import type { WorkItem, WorkItemStatus } from "@/types/work-item";

export function WorkItemInspector({
  selectedWorkItem,
  onClose,
  onUpdateStatus,
}: {
  selectedWorkItem: WorkItem;
  onClose: () => void;
  onUpdateStatus: (item: WorkItem, status: WorkItemStatus) => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Work Item Inspector">
      <div className="inspector-header">
        <div>
          <span className="tiny">work item / {selectedWorkItem.status}</span>
          <h3>{selectedWorkItem.title}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close work item inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <p className="inspector-line">
        Repository Context ID: <code>{selectedWorkItem.repositoryId}</code>
      </p>
      <p className="inspector-line">
        Priority: <code>{selectedWorkItem.priority}</code>
      </p>
      <p className="inspector-line">
        Due: <code>{selectedWorkItem.dueAt ?? selectedWorkItem.dueNote ?? "not set"}</code>
      </p>
      <p className="inspector-line">
        Notes: <code>{selectedWorkItem.notes || "none"}</code>
      </p>
      <p className="inspector-line">
        References:{" "}
        <code>
          {selectedWorkItem.contextRefs.length
            ? selectedWorkItem.contextRefs
                .map((reference) => `${reference.kind}:${reference.ref}`)
                .join(", ")
            : "none"}
        </code>
      </p>
      <div className="inspector-actions">
        {(["open", "in_progress", "blocked", "completed"] as const)
          .filter((status) => status !== selectedWorkItem.status)
          .map((status) => (
            <button
              className="outline-button"
              key={status}
              type="button"
              onClick={() => onUpdateStatus(selectedWorkItem, status)}
            >
              {status.replace("_", " ")}
            </button>
          ))}
      </div>
      <div className="work-history">
        <span className="tiny">Completion history</span>
        {selectedWorkItem.statusHistory.map((change) => (
          <p className="inspector-line" key={`${change.status}-${change.changedAt}`}>
            <code>{change.status}</code> {new Date(change.changedAt).toLocaleString()}
          </p>
        ))}
      </div>
    </aside>
  );
}
