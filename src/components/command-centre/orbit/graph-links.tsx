import type { ClientGraph, ClientGraphNode } from "../types";
import { polarPosition } from "../utils";

export function GraphLinks({ graph, nodes }: { graph: ClientGraph; nodes: ClientGraphNode[] }) {
  const nodePositions = new Map(
    nodes.map((node, index) => [node.id, polarPosition(index, nodes.length)])
  );

  return (
    <svg className="graph-links" viewBox="0 0 100 100" aria-hidden="true">
      {graph.links.map((link) => {
        const source = nodePositions.get(link.source);
        const target = nodePositions.get(link.target);
        if (!source || !target) return null;
        return (
          <line
            className={`graph-link ${link.type}`}
            key={`${link.source}-${link.target}-${link.type}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
          />
        );
      })}
    </svg>
  );
}
