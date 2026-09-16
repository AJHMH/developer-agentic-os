import type { GraphLink, GraphNode } from "@/types/second-brain";

/**
 * GraphBuilder: Deep module that encapsulates graph construction semantics.
 *
 * Responsibilities:
 * - Create nodes with consistent ID generation and metadata handling
 * - Create links with type validation
 * - Handle context references
 * - Deduplicate links automatically
 * - Provide semantic helpers for common patterns (area -> file, skill -> artifact, etc.)
 *
 * Benefits:
 * - All graph semantics in one place
 * - Node/link creation is consistent and type-safe
 * - Easy to add new node types or link patterns
 * - Testable in isolation
 */
export class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private links: GraphLink[] = [];

  /**
   * Add a node to the graph.
   * Deduplicates by ID (keeps existing if already added).
   */
  addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
    }
  }

  /**
   * Add a link between two nodes.
   * Does not validate that nodes exist (caller's responsibility).
   */
  addLink(source: string, target: string, type: GraphLink["type"]): void {
    this.links.push({ source, target, type });
  }

  /**
   * Add multiple links in one call.
   */
  addLinks(links: Array<{ source: string; target: string; type: GraphLink["type"] }>): void {
    for (const link of links) {
      this.addLink(link.source, link.target, link.type);
    }
  }

  /**
   * Add a repo node.
   */
  addRepo(id: string, name: string, path: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "repo", label: name, path, metadata });
  }

  /**
   * Add a repository context node.
   */
  addRepoContext(id: string, name: string, path: string, repositoryId: string): void {
    this.addNode({ id, type: "repo_context", label: name, path, metadata: { repositoryId } });
  }

  /**
   * Add an area node with containment link from parent.
   */
  addArea(id: string, label: string, parentId: string): void {
    this.addNode({ id, type: "area", label, path: label });
    this.addLink(parentId, id, "contains");
  }

  /**
   * Add a file node with containment link from parent (area or repo).
   */
  addFile(id: string, path: string, parentId: string, metadata?: GraphNode["metadata"]): void {
    const label = path.split("/").at(-1) ?? path;
    this.addNode({ id, type: "file", label, path, metadata });
    this.addLink(parentId, id, "contains");
  }

  /**
   * Add a skill node.
   */
  addSkill(id: string, label: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "skill", label, metadata });
  }

  /**
   * Add a routine node with optional trigger link to skill.
   */
  addRoutine(id: string, label: string, skillId?: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "routine", label, metadata });
    if (skillId) {
      this.addLink(id, skillId, "triggers");
    }
  }

  /**
   * Add an artifact node with provenance links.
   */
  addArtifact(id: string, name: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "artifact", label: name, metadata });
  }

  /**
   * Add an incoming signal node scoped to a context.
   */
  addSignal(id: string, title: string, contextId: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "incoming_signal", label: title, metadata });
    this.addLink(id, contextId, "scoped_to");
  }

  /**
   * Add a work item node scoped to a context.
   */
  addWorkItem(
    id: string,
    title: string,
    contextId: string,
    metadata?: GraphNode["metadata"]
  ): void {
    this.addNode({ id, type: "work_item", label: title, metadata });
    this.addLink(id, contextId, "scoped_to");
  }

  /**
   * Add a handoff node scoped to a context.
   */
  addHandoff(id: string, title: string, contextId: string, metadata?: GraphNode["metadata"]): void {
    this.addNode({ id, type: "handoff", label: title, metadata });
    this.addLink(id, contextId, "scoped_to");
  }

  /**
   * Add context reference links (file/area references from an artifact or work item).
   */
  addContextReferences(
    sourceId: string,
    references: Array<{ kind: string; ref: string }>,
    nodeExists: (id: string) => boolean
  ): void {
    for (const ref of references) {
      const targetId = `${ref.kind}:${ref.ref}`;
      if (nodeExists(targetId)) {
        this.addLink(sourceId, targetId, "references");
      }
    }
  }

  /**
   * Add workflow provenance links (what produced an artifact).
   */
  addProvenanceLinks(
    targetId: string,
    workflowRefs: Array<{ kind: string; ref: string }>,
    nodeExists: (id: string) => boolean
  ): void {
    for (const ref of workflowRefs) {
      const sourceId = `${ref.kind}:${ref.ref}`;
      if (nodeExists(sourceId)) {
        this.addLink(sourceId, targetId, "produced");
      }
    }
  }

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Get all nodes.
   */
  getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all links with deduplication.
   */
  getLinks(): GraphLink[] {
    return Array.from(
      new Map(
        this.links.map((link) => [`${link.source}-${link.target}-${link.type}`, link])
      ).values()
    );
  }

  /**
   * Build the final graph object.
   */
  build() {
    return {
      generatedAt: new Date().toISOString(),
      nodes: this.getNodes(),
      links: this.getLinks(),
    };
  }
}
