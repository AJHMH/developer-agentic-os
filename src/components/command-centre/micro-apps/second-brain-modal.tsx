"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { PointerEvent, WheelEvent } from "react";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileText,
  LayoutGrid,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Timer,
  X,
  Zap,
} from "lucide-react";
import type { ClientGraph, ClientGraphNode, WorkspaceData } from "../types";
import { iconForNode } from "../utils";
import type { WorkItem } from "@/types/work-item";
import type { IncomingSignal } from "@/types/incoming-signal";

const ALL_NODE_TYPES = [
  { type: "repo", label: "Repositories", icon: Database },
  { type: "area", label: "Areas", icon: LayoutGrid },
  { type: "file", label: "Files", icon: FileText },
  { type: "skill", label: "Skills", icon: Zap },
  { type: "artifact", label: "Artifacts", icon: Archive },
  { type: "work_item", label: "Work Items", icon: CheckCircle2 },
  { type: "routine", label: "Routines", icon: Timer },
  { type: "incoming_signal", label: "Signals", icon: Radio },
] as const;

type PositionedNode = ClientGraphNode & {
  x: number;
  y: number;
  tier: number;
};

export function SecondBrainModal({
  isOpen,
  onClose,
  graph,
  workspace,
  onInspectNode,
  onSelectWorkItem,
  onSelectSignal,
  onOpenArtifact,
  onRunSkill,
  onRunRoutine,
  workItems,
  signals,
  onRefresh,
}: {
  isOpen: boolean;
  onClose: () => void;
  graph: ClientGraph | null;
  workspace: WorkspaceData | null;
  onInspectNode: (node: ClientGraphNode) => void;
  onSelectWorkItem?: (item: WorkItem) => void;
  onSelectSignal?: (signal: IncomingSignal) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onRunSkill?: (skillId: string) => void;
  onRunRoutine?: (routineId: string) => void;
  workItems?: WorkItem[];
  signals?: IncomingSignal[];
  onRefresh?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set(ALL_NODE_TYPES.map((t) => t.type))
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keyboard shortcut: Escape closes modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset view
  const handleResetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Pan controls
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest(".second-brain-node-btn") ||
      (e.target as HTMLElement).closest("button")
    ) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(2.5, Math.max(0.4, prev * factor)));
  };

  // Toggle type chips
  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) {
          next.delete(type);
        }
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const selectAllTypes = () => {
    setSelectedTypes(new Set(ALL_NODE_TYPES.map((t) => t.type)));
  };

  // Node filtering
  const allNodes = graph?.nodes ?? [];
  const allLinks = graph?.links ?? [];

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allNodes.filter((node) => {
      // Type check (repo_context counts as repo)
      const mappedType = node.type === "repo_context" ? "repo" : node.type;
      if (!selectedTypes.has(mappedType)) {
        return false;
      }
      // Search check
      if (q) {
        const matchesLabel = node.label.toLowerCase().includes(q);
        const matchesPath = node.path ? node.path.toLowerCase().includes(q) : false;
        const matchesId = node.id.toLowerCase().includes(q);
        if (!matchesLabel && !matchesPath && !matchesId) {
          return false;
        }
      }
      return true;
    });
  }, [allNodes, selectedTypes, searchQuery]);

  const visibleNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  // Visible links: only links where both source and target are visible
  const visibleLinks = useMemo(() => {
    return allLinks.filter(
      (link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)
    );
  }, [allLinks, visibleNodeIds]);

  // Neighborhood adjacency map
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of allLinks) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, [allLinks]);

  const connectedNeighborIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    return adjacency.get(selectedNodeId) ?? new Set<string>();
  }, [selectedNodeId, adjacency]);

  // Compute positioned nodes (Multi-ring polar constellation)
  const positionedNodes = useMemo<PositionedNode[]>(() => {
    const width = 1200;
    const height = 800;
    const cx = width / 2;
    const cy = height / 2;

    // Partition into concentric tiers
    const tiers: Record<number, ClientGraphNode[]> = {
      0: [], // Center: repo
      1: [], // Tier 1: areas
      2: [], // Tier 2: skills, routines
      3: [], // Tier 3: work items, signals, handoffs
      4: [], // Tier 4: files, artifacts
    };

    for (const node of filteredNodes) {
      if (node.type === "repo" || node.type === "repo_context") {
        tiers[0].push(node);
      } else if (node.type === "area") {
        tiers[1].push(node);
      } else if (node.type === "skill" || node.type === "routine") {
        tiers[2].push(node);
      } else if (
        node.type === "work_item" ||
        node.type === "incoming_signal" ||
        node.type === "handoff"
      ) {
        tiers[3].push(node);
      } else {
        tiers[4].push(node);
      }
    }

    const radiusMap: Record<number, number> = {
      0: 0,
      1: 140,
      2: 240,
      3: 330,
      4: 420,
    };

    const result: PositionedNode[] = [];

    // Tier 0 (Center)
    tiers[0].forEach((node, idx) => {
      const offsetRadius = idx === 0 ? 0 : 35;
      const angle = idx === 0 ? 0 : ((2 * Math.PI) / (tiers[0].length - 1)) * (idx - 1);
      result.push({
        ...node,
        x: cx + offsetRadius * Math.cos(angle),
        y: cy + offsetRadius * Math.sin(angle),
        tier: 0,
      });
    });

    // Outer Tiers
    [1, 2, 3, 4].forEach((tierIndex) => {
      const nodesInTier = tiers[tierIndex];
      const count = nodesInTier.length;
      if (count === 0) return;
      const r = radiusMap[tierIndex];
      const angleStep = (2 * Math.PI) / count;
      const angleOffset = tierIndex * 0.35; // Slight rotation per tier for visual aesthetic

      nodesInTier.forEach((node, idx) => {
        const angle = angleStep * idx + angleOffset - Math.PI / 2;
        result.push({
          ...node,
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
          tier: tierIndex,
        });
      });
    });

    return result;
  }, [filteredNodes]);

  const positionedNodeMap = useMemo(() => {
    return new Map(positionedNodes.map((n) => [n.id, n]));
  }, [positionedNodes]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return allNodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, allNodes]);

  const neighborsOfSelected = useMemo(() => {
    if (!selectedNodeId) return [];
    const neighborIds = adjacency.get(selectedNodeId) ?? new Set<string>();
    return allNodes.filter((n) => neighborIds.has(n.id));
  }, [selectedNodeId, adjacency, allNodes]);

  if (!isOpen) return null;

  return (
    <div
      className="second-brain-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="second-brain-modal-container"
        role="dialog"
        aria-modal="true"
        aria-label="Second Brain Canvas Modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <header className="second-brain-modal-header">
          <div className="second-brain-modal-title-group">
            <span className="tiny">{workspace?.context.name ?? "Repository Memory"}</span>
            <h2>Second Brain Canvas</h2>
          </div>

          <div className="second-brain-modal-metrics">
            <span className="metric-chip" title="Visible Nodes">
              Nodes: <strong>{filteredNodes.length}</strong> / {allNodes.length}
            </span>
            <span className="metric-chip" title="Visible Links">
              Links: <strong>{visibleLinks.length}</strong> / {allLinks.length}
            </span>
            {onRefresh ? (
              <button
                className="icon-button"
                type="button"
                aria-label="Refresh graph data"
                title="Refresh graph"
                onClick={onRefresh}
              >
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <button
            className="icon-button close-modal-btn"
            type="button"
            aria-label="Close Second Brain modal"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        {/* Toolbar: Search + Filter Chips */}
        <div className="second-brain-modal-toolbar">
          <div className="second-brain-modal-search-box">
            <Search size={14} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Second Brain graph"
              className="second-brain-search-input"
              placeholder="Search by title, path, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                className="clear-search-btn"
                aria-label="Clear search"
                onClick={() => setSearchQuery("")}
              >
                <X size={12} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="second-brain-type-chips" role="group" aria-label="Node type filters">
            <button
              type="button"
              className={`second-brain-chip all-chip ${
                selectedTypes.size === ALL_NODE_TYPES.length ? "active" : ""
              }`}
              onClick={selectAllTypes}
            >
              All Types
            </button>
            {ALL_NODE_TYPES.map(({ type, label, icon: Icon }) => {
              const isSelected = selectedTypes.has(type);
              const count = allNodes.filter(
                (n) => n.type === type || (type === "repo" && n.type === "repo_context")
              ).length;
              return (
                <button
                  key={type}
                  type="button"
                  className={`second-brain-chip ${type} ${isSelected ? "active" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleType(type)}
                  title={`Toggle ${label} (${count})`}
                >
                  <Icon size={12} aria-hidden="true" />
                  <span>{label}</span>
                  <small className="chip-count">{count}</small>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Stage: Canvas + Inspector Sidebar */}
        <div className="second-brain-modal-stage">
          {/* Zoom/Pan Floating Controls */}
          <div
            className="second-brain-zoom-controls"
            role="toolbar"
            aria-label="Canvas zoom controls"
          >
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => setZoom((z) => Math.min(2.5, z * 1.2))}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Reset view"
              title="Reset view (100%)"
              onClick={handleResetView}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </div>

          {/* Interactive Canvas Viewport */}
          <div
            className={`second-brain-canvas-container ${isDragging ? "dragging" : ""}`}
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          >
            <svg
              className="second-brain-svg-canvas"
              viewBox="0 0 1200 800"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
              aria-label="Repository Knowledge Graph"
            >
              <defs>
                <radialGradient id="canvasCenterGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ff5500" stopOpacity="0.12" />
                  <stop offset="60%" stopColor="#151b23" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Background ambient center rings */}
              <circle cx="600" cy="400" r="420" className="canvas-guide-ring outer" />
              <circle cx="600" cy="400" r="330" className="canvas-guide-ring mid" />
              <circle cx="600" cy="400" r="240" className="canvas-guide-ring inner" />
              <circle cx="600" cy="400" r="140" className="canvas-guide-ring core" />
              <circle cx="600" cy="400" r="450" fill="url(#canvasCenterGlow)" />

              {/* Graph Links */}
              <g className="canvas-links-layer">
                {visibleLinks.map((link) => {
                  const s = positionedNodeMap.get(link.source);
                  const t = positionedNodeMap.get(link.target);
                  if (!s || !t) return null;

                  const isConnectedToSelected =
                    selectedNodeId !== null &&
                    (link.source === selectedNodeId || link.target === selectedNodeId);
                  const isDimmed =
                    selectedNodeId !== null &&
                    link.source !== selectedNodeId &&
                    link.target !== selectedNodeId;

                  return (
                    <line
                      key={`${link.source}-${link.target}-${link.type}`}
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      className={`canvas-graph-link ${link.type} ${
                        isConnectedToSelected ? "highlighted" : ""
                      } ${isDimmed ? "dimmed" : ""}`}
                    />
                  );
                })}
              </g>

              {/* Graph Nodes */}
              <g className="canvas-nodes-layer">
                {positionedNodes.map((node) => {
                  const isSelected = selectedNodeId === node.id;
                  const isNeighbor = connectedNeighborIds.has(node.id);
                  const isDimmed = selectedNodeId !== null && !isSelected && !isNeighbor;
                  const Icon = iconForNode(node.type);

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className={`canvas-node-group ${node.type} ${isSelected ? "selected" : ""} ${
                        isNeighbor ? "neighbor" : ""
                      } ${isDimmed ? "dimmed" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeId((current) => (current === node.id ? null : node.id));
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Node: ${node.label} (${node.type})`}
                    >
                      {/* Selection Glow Ring */}
                      {isSelected ? <circle r="26" className="node-selected-halo" /> : null}
                      {isNeighbor ? <circle r="23" className="node-neighbor-halo" /> : null}

                      {/* Main Node Circle */}
                      <circle r="18" className={`canvas-node-circle ${node.type}`} />

                      {/* Center Node Icon via foreignObject */}
                      <foreignObject
                        x="-9"
                        y="-9"
                        width="18"
                        height="18"
                        className="node-icon-foreign"
                      >
                        <div className="node-icon-wrap">
                          <Icon size={12} aria-hidden="true" />
                        </div>
                      </foreignObject>

                      {/* Node Label Below */}
                      <text
                        y="30"
                        textAnchor="middle"
                        className={`canvas-node-text ${isSelected ? "selected-text" : ""}`}
                      >
                        {node.label.length > 20 ? `${node.label.slice(0, 18)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {filteredNodes.length === 0 ? (
              <div className="canvas-empty-state">
                <p>No graph nodes match your search query or type filters.</p>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => {
                    setSearchQuery("");
                    selectAllTypes();
                  }}
                >
                  Reset Filters
                </button>
              </div>
            ) : null}
          </div>

          {/* Inspector Sidebar for Selected Node */}
          {selectedNode ? (
            <aside className="second-brain-inspector-sidebar" aria-label="Node Inspector">
              <div className="inspector-sidebar-header">
                <div>
                  <span className={`node-type-badge ${selectedNode.type}`}>
                    {selectedNode.type}
                  </span>
                  <h3>{selectedNode.label}</h3>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close node inspector"
                  onClick={() => setSelectedNodeId(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="inspector-sidebar-content">
                {selectedNode.path ? (
                  <div className="inspector-field">
                    <span className="field-label">Path:</span>
                    <div className="field-row">
                      <code className="path-code">{selectedNode.path}</code>
                      <button
                        type="button"
                        className="copy-snippet-btn"
                        aria-label="Copy file path"
                        onClick={() => {
                          if (selectedNode.path) {
                            void navigator.clipboard.writeText(selectedNode.path);
                            setCopyStatus("Copied!");
                            setTimeout(() => setCopyStatus(null), 2000);
                          }
                        }}
                      >
                        <Copy size={11} aria-hidden="true" />
                        <span>{copyStatus ?? "Copy"}</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Metadata List */}
                {selectedNode.metadata ? (
                  <div className="inspector-field">
                    <span className="field-label">Metadata:</span>
                    <div className="metadata-table">
                      {Object.entries(selectedNode.metadata).map(([k, v]) => (
                        <div key={k} className="metadata-row">
                          <span className="meta-key">{k}:</span>
                          <span className="meta-val">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Deep-Link Actions */}
                <div className="inspector-sidebar-actions">
                  <span className="field-label">Actions:</span>
                  <div className="action-buttons-group">
                    {selectedNode.type === "artifact" ? (
                      <button
                        type="button"
                        className="action-button primary"
                        onClick={() => {
                          onInspectNode(selectedNode);
                          if (onOpenArtifact) {
                            onOpenArtifact(selectedNode.id.replace("artifact:", ""));
                          }
                        }}
                      >
                        <ExternalLink size={12} aria-hidden="true" /> Open Artifact Inspector
                      </button>
                    ) : null}

                    {selectedNode.type === "work_item" ? (
                      <button
                        type="button"
                        className="action-button primary"
                        onClick={() => {
                          const itemId = selectedNode.id.replace("work_item:", "");
                          const item = workItems?.find((w) => w.id === itemId);
                          if (item && onSelectWorkItem) {
                            onSelectWorkItem(item);
                            onClose();
                          } else {
                            onInspectNode(selectedNode);
                          }
                        }}
                      >
                        <ExternalLink size={12} aria-hidden="true" /> Open Work Item Details
                      </button>
                    ) : null}

                    {selectedNode.type === "incoming_signal" ? (
                      <button
                        type="button"
                        className="action-button primary"
                        onClick={() => {
                          const sigId = selectedNode.id.replace("incoming_signal:", "");
                          const sig = signals?.find((s) => s.id === sigId);
                          if (sig && onSelectSignal) {
                            onSelectSignal(sig);
                            onClose();
                          } else {
                            onInspectNode(selectedNode);
                          }
                        }}
                      >
                        <ExternalLink size={12} aria-hidden="true" /> Triage Signal
                      </button>
                    ) : null}

                    {selectedNode.type === "skill" && onRunSkill ? (
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => onRunSkill(selectedNode.id.replace("skill:", ""))}
                      >
                        <Zap size={12} aria-hidden="true" /> Run Skill
                      </button>
                    ) : null}

                    {selectedNode.type === "routine" && onRunRoutine ? (
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => onRunRoutine(selectedNode.id.replace("routine:", ""))}
                      >
                        <Timer size={12} aria-hidden="true" /> Run Routine
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Connected Neighbors (Traversal) */}
                <div className="inspector-field">
                  <span className="field-label">
                    Connected Connections ({neighborsOfSelected.length}):
                  </span>
                  <div className="inspector-neighbors-list" role="list">
                    {neighborsOfSelected.length === 0 ? (
                      <p className="no-neighbors">No direct neighbors found.</p>
                    ) : (
                      neighborsOfSelected.map((neighbor) => {
                        const NeighborIcon = iconForNode(neighbor.type);
                        return (
                          <button
                            key={neighbor.id}
                            type="button"
                            className="neighbor-row-btn"
                            onClick={() => setSelectedNodeId(neighbor.id)}
                            title={`Focus on ${neighbor.label}`}
                          >
                            <NeighborIcon size={12} aria-hidden="true" />
                            <span className="neighbor-label">{neighbor.label}</span>
                            <span className={`node-type-badge ${neighbor.type} tiny-badge`}>
                              {neighbor.type}
                            </span>
                            <ArrowRight size={10} className="traverse-arrow" aria-hidden="true" />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}
