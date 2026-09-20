import { RefreshCw } from "lucide-react";
import type { ClientGraph, ClientGraphNode, WorkspaceData } from "../types";
import { iconForNode } from "../utils";

export function SecondBrainDrawer({
  workspace,
  graph,
  secondBrainSearch,
  setSecondBrainSearch,
  secondBrainTypeFilter,
  setSecondBrainTypeFilter,
  filteredGraphNodes,
  selectedNode,
  onInspectNode,
  onRefresh,
}: {
  workspace: WorkspaceData | null;
  graph: ClientGraph | null;
  secondBrainSearch: string;
  setSecondBrainSearch: (value: string) => void;
  secondBrainTypeFilter: string;
  setSecondBrainTypeFilter: (value: string) => void;
  filteredGraphNodes: ClientGraphNode[];
  selectedNode: ClientGraphNode | null;
  onInspectNode: (node: ClientGraphNode) => void;
  onRefresh: () => void;
}) {
  return (
    <section
      className="workspace-switcher-detail second-brain-app"
      id="second-brain"
      aria-label="Second Brain Explorer"
    >
      <div className="second-brain-app-header">
        <div>
          <span className="tiny">{workspace?.context.name ?? "selected repository"}</span>
          <strong>Second Brain Explorer</strong>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Refresh graph"
          title="Refresh graph data"
          onClick={onRefresh}
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>

      {graph ? (
        <>
          <div className="second-brain-metrics">
            <span className="metric-chip" title="Total Nodes">
              Nodes: <strong>{graph.nodes.length}</strong>
            </span>
            <span className="metric-chip" title="Total Links">
              Links: <strong>{graph.links.length}</strong>
            </span>
          </div>

          <div className="second-brain-controls">
            <input
              aria-label="Filter graph nodes"
              className="second-brain-search"
              placeholder="Search nodes or paths..."
              value={secondBrainSearch}
              onChange={(event) => setSecondBrainSearch(event.target.value)}
            />
            <select
              aria-label="Filter nodes by type"
              className="second-brain-type-select"
              value={secondBrainTypeFilter}
              onChange={(event) => setSecondBrainTypeFilter(event.target.value)}
            >
              <option value="all">All types</option>
              <option value="artifact">Artifacts</option>
              <option value="skill">Skills</option>
              <option value="routine">Routines</option>
              <option value="work_item">Work Items</option>
              <option value="file">Files</option>
              <option value="incoming_signal">Signals</option>
              <option value="repo">Repository</option>
            </select>
          </div>

          <div className="second-brain-node-list" role="list" aria-label="Graph nodes">
            {filteredGraphNodes.length === 0 ? (
              <p className="dashboard-placeholder">No matching nodes found.</p>
            ) : (
              filteredGraphNodes.slice(0, 30).map((node) => {
                const Icon = iconForNode(node.type);
                const isSelected = selectedNode?.id === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`second-brain-node-row ${isSelected ? "active" : ""}`}
                    onClick={() => onInspectNode(node)}
                    aria-pressed={isSelected}
                  >
                    <span className="node-row-main">
                      <Icon size={13} aria-hidden="true" />
                      <span className="node-row-label">
                        <strong>{node.label}</strong>
                        {node.path ? <small>{node.path}</small> : null}
                      </span>
                    </span>
                    <span className={`node-type-badge ${node.type}`}>{node.type}</span>
                  </button>
                );
              })
            )}
            {filteredGraphNodes.length > 30 ? (
              <p className="second-brain-more">
                + {filteredGraphNodes.length - 30} more nodes (refine search)
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="dashboard-placeholder">Loading Second Brain graph...</p>
      )}
    </section>
  );
}
