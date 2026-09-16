export type GraphNodeType =
  | "repo"
  | "repo_context"
  | "area"
  | "file"
  | "artifact"
  | "skill"
  | "work_item"
  | "incoming_signal"
  | "handoff"
  | "routine";
export type GraphLinkType =
  | "contains"
  | "references"
  | "produced"
  | "used_context"
  | "triggers"
  | "scoped_to"
  | "includes"
  | "finalized_as";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  path?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type GraphLink = {
  source: string;
  target: string;
  type: GraphLinkType;
};

export type SecondBrainGraph = {
  generatedAt: string;
  nodes: GraphNode[];
  links: GraphLink[];
};
