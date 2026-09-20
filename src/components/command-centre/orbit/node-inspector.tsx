import type { ClientGraphNode } from "../types";

export function NodeInspector({
  selectedNode,
  onClose,
  artifactContent,
  inspectorStatus,
  onOpenArtifact,
  onRunSkill,
  onRunRoutine,
  onNavigateNode,
  onCopyPath,
}: {
  selectedNode: ClientGraphNode;
  onClose: () => void;
  artifactContent: string | null;
  inspectorStatus: string | null;
  onOpenArtifact: () => void;
  onRunSkill: () => void;
  onRunRoutine: (routineId: string) => void;
  onNavigateNode: () => void;
  onCopyPath: () => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Inspector Panel">
      <div className="inspector-header">
        <div>
          <span className="tiny">{selectedNode.type}</span>
          <h3>{selectedNode.label}</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
        >
          x
        </button>
      </div>
      {selectedNode.path ? (
        <p className="inspector-line">
          Path: <code>{selectedNode.path}</code>
        </p>
      ) : null}
      {selectedNode.metadata
        ? Object.entries(selectedNode.metadata).map(([key, value]) => (
            <p className="inspector-line" key={key}>
              {key}: <code>{String(value)}</code>
            </p>
          ))
        : null}
      <div className="inspector-actions">
        {selectedNode.type === "artifact" ? (
          <button className="outline-button" type="button" onClick={onOpenArtifact}>
            Open Artifact
          </button>
        ) : null}
        {selectedNode.type === "skill" ? (
          <button className="outline-button" type="button" onClick={onRunSkill}>
            Run Skill
          </button>
        ) : null}
        {selectedNode.type === "routine" ? (
          <button
            className="outline-button"
            type="button"
            onClick={() => onRunRoutine(selectedNode.id.replace("routine:", ""))}
          >
            Run Routine
          </button>
        ) : null}
        {selectedNode.type === "repo" || selectedNode.type === "work_item" ? (
          <button className="outline-button" type="button" onClick={onNavigateNode}>
            {selectedNode.type === "repo" ? "Use Active Context" : "Open Work Item"}
          </button>
        ) : null}
        {selectedNode.type === "file" ? (
          <button className="outline-button" type="button" onClick={onCopyPath}>
            Copy Path
          </button>
        ) : null}
        {selectedNode.type === "repo" || selectedNode.type === "area" ? (
          <button className="outline-button" type="button" onClick={() => window.location.reload()}>
            Refresh Graph
          </button>
        ) : null}
      </div>
      {inspectorStatus ? <p className="inspector-status">{inspectorStatus}</p> : null}
      {artifactContent !== null ? <pre className="inspector-content">{artifactContent}</pre> : null}
    </aside>
  );
}
