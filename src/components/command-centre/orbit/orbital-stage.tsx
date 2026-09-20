import type { CSSProperties } from "react";
import type { ClientGraph, ClientGraphNode } from "../types";
import { orbitIcons } from "../types";
import { iconForNode } from "../utils";
import { Constellation } from "./constellation";
import { GraphLinks } from "./graph-links";

export function OrbitalStage({
  secondBrainOpen,
  renderOrbitSize,
  orbitRef,
  graph,
  graphNodes,
  onInspectNode,
}: {
  secondBrainOpen: boolean;
  renderOrbitSize: number;
  orbitRef: (node: HTMLDivElement | null) => void;
  graph: ClientGraph | null;
  graphNodes: ClientGraphNode[];
  onInspectNode: (node: ClientGraphNode) => void;
}) {
  return (
    <div className={`orbital-stage ${secondBrainOpen ? "second-brain-focused" : ""}`}>
      <div
        className="orbit"
        ref={orbitRef}
        style={{ "--orbit-radius": `${renderOrbitSize / 2}px` } as CSSProperties}
      >
        <Constellation />
        <div className="core-cluster" />
        {graph ? <GraphLinks graph={graph} nodes={graphNodes} /> : null}
        <div className="node-ring">
          {graphNodes.map((node, index) => {
            const Icon = iconForNode(node.type);
            const angle = (360 / orbitIcons.length) * index - 90;
            const tone = node.type === "artifact" ? "hot" : node.type === "skill" ? "blue" : "";
            return (
              <button
                className={`orb-node ${tone}`}
                style={{ "--angle": `${angle}deg` } as CSSProperties}
                key={node.id}
                type="button"
                aria-label={
                  node.type === "work_item"
                    ? "Inspect graph work item"
                    : node.type === "incoming_signal"
                      ? "Inspect graph signal"
                      : `Inspect ${node.label}`
                }
                onClick={() => onInspectNode(node)}
              >
                <Icon size={19} aria-hidden="true" />
                <small>{String(index + 1).padStart(2, "0")}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
