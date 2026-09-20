# src/types/second-brain.ts

- GraphNodeType · type · L1-L11 — type GraphNodeType = | "repo" | "repo_context" | "area" | "file" | "artifact" | "skill" | "work_item" | "incoming_signal" | "handoff" | "routine";
- GraphLinkType · type · L12-L20 — type GraphLinkType = | "contains" | "references" | "produced" | "used_context" | "triggers" | "scoped_to" | "includes" | "finalized_as";
- GraphNode · type · L22-L28 — type GraphNode = { id: string; type: GraphNodeType; label: string; path?: string; metadata?: Record<string, string | number | boolean | null>; };
- GraphLink · type · L30-L34 — type GraphLink = { source: string; target: string; type: GraphLinkType; };
- SecondBrainGraph · type · L36-L40 — type SecondBrainGraph = { generatedAt: string; nodes: GraphNode[]; links: GraphLink[]; };
