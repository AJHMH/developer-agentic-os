"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactIndexEntry } from "@/types/artifact";
import type { IntegrationAdapterStatus } from "@/types/integration";
import type { GitHubOperations } from "@/types/github";
import type { VercelOperations } from "@/types/vercel";
import type { RoutineDefinition, RoutineExecutorStatus } from "@/types/routine";
import type { SkillCommand } from "@/types/skill";
import type { RepositoryContext, RepositorySwitcherEntry } from "@/types/workspace";
import type { WorkItem, WorkItemPriority, WorkItemStatus } from "@/types/work-item";
import type {
  IncomingSignal,
  IncomingSignalSource,
  IncomingSignalStatus,
} from "@/types/incoming-signal";
import type { SignalTriageAction } from "@/types/signal-triage";
import type { FocusBoard } from "@/types/focus-board";
import type { Handoff } from "@/types/handoff";
import { AuthControls } from "./auth-controls";
import type {
  AutomationRun,
  OperationalAuditRecord,
  OperationalIncident,
} from "@/types/operational";
import {
  Archive,
  BarChart3,
  CalendarDays,
  CircleDotDashed,
  Database,
  FileText,
  GitBranch,
  Globe,
  Grip,
  Info,
  Inbox,
  LayoutGrid,
  Mail,
  MailCheck,
  Monitor,
  Play,
  Plus,
  Route,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  PanelLeftClose,
  PanelRightClose,
  Timer,
  Zap,
  CheckCircle2,
  ClipboardPen,
  type LucideIcon,
} from "lucide-react";

const microApps: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: GitBranch,
    title: "Workspace Switcher",
    description: "Change the active repository context",
  },
  {
    icon: CheckCircle2,
    title: "Today / Focus Board",
    description: "Daily attention for the selected repository",
  },
  { icon: Route, title: "Second Brain", description: "Workspace graph and living map" },
  {
    icon: ClipboardPen,
    title: "Session Handoff",
    description: "Draft and finalize repository context",
  },
];

type DashboardData = {
  artifacts: ArtifactIndexEntry[];
  skills: SkillCommand[];
  routines: RoutineDefinition[];
  executor: RoutineExecutorStatus;
  integrations: IntegrationAdapterStatus[];
  focusBoard: FocusBoard | null;
};

function providerActionForRun(run: AutomationRun): "github-rerun" | "vercel-redeploy" | null {
  if (typeof run.input.actionRunId === "string" && run.input.actionRunId) return "github-rerun";
  if (typeof run.input.deploymentId === "string" && run.input.deploymentId)
    return "vercel-redeploy";
  return null;
}

type WorkspaceData = {
  context: RepositoryContext;
  repositories: RepositorySwitcherEntry[];
};

type LayoutState = {
  pageWidth: number;
  orbitSize: number;
  widgetSizes: Record<string, { width: number; height: number }>;
};

type ClientGraphNode = {
  id: string;
  type:
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
  label: string;
  path?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type ClientGraphLink = {
  source: string;
  target: string;
  type:
    | "contains"
    | "references"
    | "produced"
    | "used_context"
    | "triggers"
    | "scoped_to"
    | "includes"
    | "finalized_as";
};

type ClientGraph = {
  nodes: ClientGraphNode[];
  links: ClientGraphLink[];
};

const layoutStorageKey = "developer-agentic-os-layout-v1";
const baselineLayout: LayoutState = { pageWidth: 1480, orbitSize: 660, widgetSizes: {} };

function usePersistedLayout() {
  const [layout, setLayout] = useState<LayoutState>(baselineLayout);
  const [hasLoadedLayout, setHasLoadedLayout] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(layoutStorageKey);
      if (saved) setLayout({ ...baselineLayout, ...JSON.parse(saved) });
    } catch {
      setLayout(baselineLayout);
    } finally {
      setHasLoadedLayout(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedLayout) return;
    localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  }, [hasLoadedLayout, layout]);

  const setPageWidth = useCallback(
    (pageWidth: number) => setLayout((current) => ({ ...current, pageWidth })),
    []
  );
  const setOrbitSize = useCallback(
    (orbitSize: number) => setLayout((current) => ({ ...current, orbitSize })),
    []
  );
  const setWidgetSize = useCallback((id: string, size: { width: number; height: number }) => {
    setLayout((current) => {
      const existing = current.widgetSizes[id];
      if (
        existing &&
        Math.abs(existing.width - size.width) < 1 &&
        Math.abs(existing.height - size.height) < 1
      )
        return current;
      return { ...current, widgetSizes: { ...current.widgetSizes, [id]: size } };
    });
  }, []);
  const resetLayout = useCallback(() => {
    localStorage.removeItem(layoutStorageKey);
    setLayout(baselineLayout);
  }, []);

  return { layout, setPageWidth, setOrbitSize, setWidgetSize, resetLayout };
}

function useResizePersistence(
  setWidgetSize: (id: string, size: { width: number; height: number }) => void,
  activeResizeIds: { current: Set<string> },
  initialResizeSizes: { current: Map<string, { width: number; height: number }> }
) {
  const observers = useRef(new Map<string, ResizeObserver>());

  useEffect(
    () => () => {
      observers.current.forEach((observer) => observer.disconnect());
      observers.current.clear();
    },
    []
  );

  return useCallback(
    (id: string) => (node: HTMLElement | null) => {
      observers.current.get(id)?.disconnect();
      observers.current.delete(id);
      if (!node) return;

      const observer = new ResizeObserver(([entry]) => {
        if (!entry) return;
        if (!activeResizeIds.current.has(id)) return;
        const initial = initialResizeSizes.current.get(id);
        const { width, height } = node.getBoundingClientRect();
        if (initial && Math.abs(initial.width - width) < 1 && Math.abs(initial.height - height) < 1)
          return;
        setWidgetSize(id, { width: Math.round(width), height: Math.round(height) });
      });
      observer.observe(node);
      observers.current.set(id, observer);
    },
    [activeResizeIds, initialResizeSizes, setWidgetSize]
  );
}

function resizableStyle(id: string, layout: LayoutState): CSSProperties | undefined {
  const size = layout.widgetSizes[id];
  return size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined;
}

const orbitIcons: LucideIcon[] = [
  Zap,
  Zap,
  Zap,
  Mail,
  Play,
  BarChart3,
  Globe,
  Zap,
  Zap,
  Zap,
  Database,
  Timer,
  Search,
  Archive,
  FileText,
  Mail,
  Play,
  CircleDotDashed,
  MailCheck,
  FileText,
  LayoutGrid,
  GitBranch,
  Monitor,
  Database,
  Info,
  Zap,
];

function ModuleHeading({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="module-heading">
      <div className="heading-left">
        <Icon className="icon-box" aria-hidden="true" size={19} />
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function OutlineButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="outline-button" type="button">
      {children}
    </button>
  );
}

function Constellation() {
  const dots = Array.from({ length: 72 }, (_, index) => {
    const angle = index * 137.5;
    const radius = 24 + (index % 18) * 10;
    const x = 350 + Math.cos((angle * Math.PI) / 180) * radius;
    const y = 318 + Math.sin((angle * Math.PI) / 180) * radius * 0.86;
    return { x, y, hot: index % 11 === 0 };
  });

  return (
    <svg
      className="constellation"
      viewBox="0 0 700 620"
      role="img"
      aria-label="Workspace constellation map"
    >
      {dots.slice(0, 46).map((dot, index) => {
        const target = dots[(index * 7 + 9) % dots.length];
        return (
          <line
            key={`line-${index}`}
            x1={dot.x.toFixed(1)}
            y1={dot.y.toFixed(1)}
            x2={target.x.toFixed(1)}
            y2={target.y.toFixed(1)}
            stroke="rgba(232,216,188,0.11)"
            strokeWidth="1"
          />
        );
      })}
      {dots.map((dot, index) => (
        <circle
          key={`dot-${index}`}
          cx={dot.x.toFixed(1)}
          cy={dot.y.toFixed(1)}
          r={dot.hot ? 2.2 : 1.3}
          fill={dot.hot ? "#ff6a1b" : "rgba(243,238,229,0.58)"}
        />
      ))}
    </svg>
  );
}

function GraphLinks({ graph, nodes }: { graph: ClientGraph; nodes: ClientGraphNode[] }) {
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

function polarPosition(index: number, count: number): { x: number; y: number } {
  const angle = ((360 / Math.max(count, 1)) * index - 90) * (Math.PI / 180);
  const radius = 41;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

async function requireOk<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export function CommandCentreShell() {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(true);
  const [renderOrbitSize, setRenderOrbitSize] = useState(baselineLayout.orbitSize);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [focusBoardOpen, setFocusBoardOpen] = useState(true);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [githubOperations, setGitHubOperations] = useState<GitHubOperations | null>(null);
  const [githubOperationsLoading, setGitHubOperationsLoading] = useState(false);
  const [vercelOperations, setVercelOperations] = useState<VercelOperations | null>(null);
  const [vercelOperationsLoading, setVercelOperationsLoading] = useState(false);
  const [graph, setGraph] = useState<ClientGraph | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData>({
    artifacts: [],
    skills: [],
    routines: [],
    integrations: [],
    focusBoard: null,
    executor: {
      running: false,
      leaseExpiresAt: null,
      lastTickAt: null,
      lastRunAt: null,
      lastError: null,
    },
  });
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [configuredSkill, setConfiguredSkill] = useState<SkillCommand | null>(null);
  const [selectedNode, setSelectedNode] = useState<ClientGraphNode | null>(null);
  const [selectedOperationalRun, setSelectedOperationalRun] = useState<AutomationRun | null>(null);
  const [selectedOperationalIncident, setSelectedOperationalIncident] = useState<
    (OperationalIncident & { events: import("@/types/operational").OperationalEvent[] }) | null
  >(null);
  const [selectedOperationalAudit, setSelectedOperationalAudit] =
    useState<OperationalAuditRecord | null>(null);
  const [globalOperationalPaused, setGlobalOperationalPaused] = useState(false);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [inspectorStatus, setInspectorStatus] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [workItemStatusFilter, setWorkItemStatusFilter] = useState<WorkItemStatus | "all">("all");
  const [workItemRepositoryFilter, setWorkItemRepositoryFilter] = useState<string>("active");
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(null);
  const [workItemTitle, setWorkItemTitle] = useState("");
  const [workItemNotes, setWorkItemNotes] = useState("");
  const [workItemPriority, setWorkItemPriority] = useState<WorkItemPriority>("normal");
  const [workItemDueAt, setWorkItemDueAt] = useState("");
  const [workItemReferences, setWorkItemReferences] = useState("");
  const [signals, setSignals] = useState<IncomingSignal[]>([]);
  const [signalStatusFilter, setSignalStatusFilter] = useState<IncomingSignalStatus | "all">("all");
  const [signalSourceFilter, setSignalSourceFilter] = useState<IncomingSignalSource | "all">("all");
  const [selectedSignal, setSelectedSignal] = useState<IncomingSignal | null>(null);
  const [signalSource, setSignalSource] = useState<IncomingSignalSource>("manual");
  const [signalTitle, setSignalTitle] = useState("");
  const [signalBody, setSignalBody] = useState("");
  const [triageTargetId, setTriageTargetId] = useState("");
  const [signalTriageStatus, setSignalTriageStatus] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [selectedHandoff, setSelectedHandoff] = useState<Handoff | null>(null);
  const [handoffTitle, setHandoffTitle] = useState("");
  const [handoffDecisions, setHandoffDecisions] = useState("");
  const [handoffBlockers, setHandoffBlockers] = useState("");
  const [handoffNextActions, setHandoffNextActions] = useState("");
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const loadHandoffs = useCallback(async (repositoryId: string) => {
    const result = await fetch(
      `/api/handoffs?repositoryId=${encodeURIComponent(repositoryId)}`
    ).then((response) => requireOk<{ handoffs: Handoff[] }>(response));
    setHandoffs(result.handoffs);
  }, []);
  const activeResizeIds = useRef(new Set<string>());
  const initialResizeSizes = useRef(new Map<string, { width: number; height: number }>());
  const { layout, setPageWidth, setOrbitSize, setWidgetSize, resetLayout } = usePersistedLayout();
  const resizeRef = useResizePersistence(setWidgetSize, activeResizeIds, initialResizeSizes);
  const markResizeStart = useCallback((id: string, element: HTMLElement) => {
    const { width, height } = element.getBoundingClientRect();
    initialResizeSizes.current.set(id, { width, height });
    activeResizeIds.current.add(id);
  }, []);

  const orbitRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const update = () => setRenderOrbitSize(Math.round(node.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const clearActiveResize = () => {
      activeResizeIds.current.clear();
      initialResizeSizes.current.clear();
    };
    window.addEventListener("pointerup", clearActiveResize);
    return () => window.removeEventListener("pointerup", clearActiveResize);
  }, []);

  const loadDashboard = useCallback(async (repositoryId?: string) => {
    setDashboardLoading(true);
    setGitHubOperations(null);
    setVercelOperations(null);
    const contextQuery = repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : "";
    const artifactQuery = repositoryId
      ? `?repositoryId=${encodeURIComponent(repositoryId)}&limit=6`
      : "?limit=6";
    const requests = await Promise.allSettled([
      fetch(`/api/second-brain/graph${contextQuery}`).then((response) =>
        requireOk<ClientGraph>(response)
      ),
      fetch(`/api/artifacts${artifactQuery}`).then((response) =>
        requireOk<{ artifacts: ArtifactIndexEntry[] }>(response)
      ),
      fetch("/api/skills").then((response) => requireOk<{ skills: SkillCommand[] }>(response)),
      fetch(`/api/routines${contextQuery}`).then((response) =>
        requireOk<{ routines: RoutineDefinition[]; executor: RoutineExecutorStatus }>(response)
      ),
      fetch(`/api/integrations${contextQuery}`).then((response) =>
        requireOk<{ integrations: IntegrationAdapterStatus[] }>(response)
      ),
      fetch(`/api/integrations/github${contextQuery}`).then((response) =>
        requireOk<GitHubOperations>(response)
      ),
      fetch(`/api/integrations/vercel${contextQuery}`).then((response) =>
        requireOk<VercelOperations>(response)
      ),
      fetch(`/api/focus-board${contextQuery}`).then((response) => requireOk<FocusBoard>(response)),
      fetch(`/api/operational${contextQuery}`).then((response) =>
        requireOk<{ globalPaused: boolean }>(response)
      ),
    ]);

    const [
      graphResult,
      artifactsResult,
      skillsResult,
      routinesResult,
      integrationsResult,
      githubResult,
      vercelResult,
      focusBoardResult,
      operationalResult,
    ] = requests;
    if (graphResult.status === "fulfilled")
      setGraph({ ...graphResult.value, links: graphResult.value.links ?? [] });
    const failures = requests.filter((result) => result.status === "rejected");
    setDashboard({
      artifacts: artifactsResult.status === "fulfilled" ? artifactsResult.value.artifacts : [],
      skills: skillsResult.status === "fulfilled" ? skillsResult.value.skills : [],
      routines: routinesResult.status === "fulfilled" ? routinesResult.value.routines : [],
      executor:
        routinesResult.status === "fulfilled" ? routinesResult.value.executor : dashboard.executor,
      integrations:
        integrationsResult.status === "fulfilled" ? integrationsResult.value.integrations : [],
      focusBoard: focusBoardResult.status === "fulfilled" ? focusBoardResult.value : null,
    });
    setGitHubOperations(githubResult.status === "fulfilled" ? githubResult.value : null);
    setVercelOperations(vercelResult.status === "fulfilled" ? vercelResult.value : null);
    if (operationalResult.status === "fulfilled")
      setGlobalOperationalPaused(operationalResult.value.globalPaused);
    setDashboardError(failures.length ? "Some workspace data could not be loaded." : null);
    setDashboardLoading(false);
  }, []);

  const loadGitHubOperations = useCallback(async (repositoryId: string) => {
    setGitHubOperationsLoading(true);
    try {
      const result = await fetch(
        `/api/integrations/github?repositoryId=${encodeURIComponent(repositoryId)}`
      ).then((response) => requireOk<GitHubOperations>(response));
      setGitHubOperations(result);
    } catch {
      setGitHubOperations(null);
    } finally {
      setGitHubOperationsLoading(false);
    }
  }, []);

  const loadVercelOperations = useCallback(async (repositoryId: string) => {
    setVercelOperationsLoading(true);
    try {
      const result = await fetch(
        `/api/integrations/vercel?repositoryId=${encodeURIComponent(repositoryId)}`
      ).then((response) => requireOk<VercelOperations>(response));
      setVercelOperations(result);
    } catch {
      setVercelOperations(null);
    } finally {
      setVercelOperationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!integrationOpen || !workspace?.context.id || githubOperations) return;
    void loadGitHubOperations(workspace.context.id);
  }, [integrationOpen, loadGitHubOperations, workspace?.context.id]);

  useEffect(() => {
    if (!integrationOpen || !workspace?.context.id || vercelOperations) return;
    void loadVercelOperations(workspace.context.id);
  }, [integrationOpen, loadVercelOperations, vercelOperations, workspace?.context.id]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspace() {
      try {
        const [context, repositories] = await Promise.all([
          fetch("/api/workspace/context").then((response) =>
            requireOk<{ context: RepositoryContext }>(response)
          ),
          fetch("/api/workspace/repositories").then((response) =>
            requireOk<{ repositories: RepositorySwitcherEntry[] }>(response)
          ),
        ]);
        if (!isMounted) return;
        setWorkspace({ context: context.context, repositories: repositories.repositories });
        setWorkspaceError(null);
        void loadDashboard(context.context.id);
        void loadHandoffs(context.context.id).catch(() => setHandoffs([]));
      } catch {
        if (isMounted) setWorkspaceError("Workspace contexts could not be loaded.");
      } finally {
        if (isMounted) setWorkspaceLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      isMounted = false;
    };
  }, [loadDashboard, loadHandoffs]);

  const createHandoff = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!workspace?.context.id) return;
      setHandoffStatus("Capturing repository context...");
      const response = await fetch("/api/handoffs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: workspace.context.id,
          title: handoffTitle,
          decisions: handoffDecisions.split("\n"),
          blockers: handoffBlockers.split("\n"),
          nextActions: handoffNextActions.split("\n"),
        }),
      });
      if (!response.ok) {
        setHandoffStatus("Draft could not be created.");
        return;
      }
      const handoff = (await response.json()) as Handoff;
      setHandoffs((current) => [handoff, ...current]);
      setSelectedHandoff(handoff);
      setHandoffTitle(handoff.title);
      setHandoffDecisions(handoff.decisions.join("\n"));
      setHandoffBlockers(handoff.blockers.join("\n"));
      setHandoffNextActions(handoff.nextActions.join("\n"));
      setHandoffStatus("Draft created.");
    },
    [handoffBlockers, handoffDecisions, handoffNextActions, handoffTitle, workspace?.context.id]
  );

  const selectHandoff = useCallback((handoff: Handoff) => {
    setSelectedHandoff(handoff);
    setHandoffTitle(handoff.title);
    setHandoffDecisions(handoff.decisions.join("\n"));
    setHandoffBlockers(handoff.blockers.join("\n"));
    setHandoffNextActions(handoff.nextActions.join("\n"));
    setHandoffStatus(null);
  }, []);

  const saveHandoff = useCallback(async () => {
    if (!selectedHandoff || selectedHandoff.status === "finalized") return;
    setHandoffStatus("Saving draft...");
    const response = await fetch(`/api/handoffs/${selectedHandoff.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: workspace?.context.id,
        title: handoffTitle,
        decisions: handoffDecisions.split("\n"),
        blockers: handoffBlockers.split("\n"),
        nextActions: handoffNextActions.split("\n"),
      }),
    });
    if (!response.ok) {
      setHandoffStatus("Draft could not be saved.");
      return;
    }
    const handoff = (await response.json()) as Handoff;
    setHandoffs((current) => current.map((item) => (item.id === handoff.id ? handoff : item)));
    setSelectedHandoff(handoff);
    setHandoffStatus("Draft saved.");
  }, [
    handoffBlockers,
    handoffDecisions,
    handoffNextActions,
    handoffTitle,
    selectedHandoff,
    workspace?.context.id,
  ]);

  const finalizeHandoff = useCallback(async () => {
    if (!selectedHandoff) return;
    setHandoffStatus("Finalizing immutable artifact...");
    const response = await fetch(
      `/api/handoffs/${selectedHandoff.id}/finalize?repositoryId=${encodeURIComponent(workspace?.context.id ?? "")}`,
      { method: "POST" }
    );
    if (!response.ok) {
      setHandoffStatus("Handoff could not be finalized.");
      return;
    }
    const handoff = (await response.json()) as Handoff;
    setHandoffs((current) => current.map((item) => (item.id === handoff.id ? handoff : item)));
    setSelectedHandoff(handoff);
    setHandoffStatus("Finalized Handoff Artifact created.");
  }, [selectedHandoff, workspace?.context.id]);

  const switchRepository = useCallback(
    async (id: string) => {
      if (!workspace || id === workspace.context.id) return;
      setWorkspaceError(null);
      try {
        const response = await fetch("/api/workspace/context", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const result = await requireOk<{ context: RepositoryContext }>(response);
        setWorkspace((current) => (current ? { ...current, context: result.context } : current));
        await Promise.all([loadDashboard(result.context.id), loadHandoffs(result.context.id)]);
      } catch {
        setWorkspaceError("Repository context could not be switched.");
      }
    },
    [loadDashboard, loadHandoffs, workspace]
  );

  const loadWorkItems = useCallback(
    async (repositoryId = workItemRepositoryFilter, status = workItemStatusFilter) => {
      const params = new URLSearchParams();
      if (repositoryId !== "all" && repositoryId !== "active")
        params.set("repositoryId", repositoryId);
      if (status !== "all") params.set("status", status);
      const response = await fetch(`/api/work-items?${params.toString()}`);
      const result = await requireOk<{ workItems: WorkItem[] }>(response);
      setWorkItems(result.workItems);
    },
    [workItemRepositoryFilter, workItemStatusFilter]
  );

  useEffect(() => {
    void loadWorkItems(
      workItemRepositoryFilter === "active"
        ? (workspace?.context.id ?? "all")
        : workItemRepositoryFilter,
      workItemStatusFilter
    ).catch(() => setWorkItems([]));
  }, [loadWorkItems, workItemRepositoryFilter, workItemStatusFilter, workspace?.context.id]);

  const createWorkItem = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!workspace?.context.id || !workItemTitle.trim()) return;
      const contextRefs = workItemReferences
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [kind, ...refParts] = value.split(":");
          return { kind, ref: refParts.join(":").trim() };
        });
      const response = await fetch("/api/work-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: workItemTitle,
          notes: workItemNotes,
          priority: workItemPriority,
          dueAt: workItemDueAt || null,
          contextRefs,
          repositoryId: workspace.context.id,
        }),
      });
      if (!response.ok) return;
      setWorkItemTitle("");
      setWorkItemNotes("");
      setWorkItemPriority("normal");
      setWorkItemDueAt("");
      setWorkItemReferences("");
      await Promise.all([
        loadWorkItems(
          workItemRepositoryFilter === "active" ? workspace.context.id : workItemRepositoryFilter,
          workItemStatusFilter
        ),
        loadDashboard(workspace.context.id),
      ]);
    },
    [
      loadDashboard,
      loadWorkItems,
      workItemDueAt,
      workItemNotes,
      workItemPriority,
      workItemReferences,
      workItemRepositoryFilter,
      workItemStatusFilter,
      workItemTitle,
      workspace,
    ]
  );

  const updateWorkItemStatus = useCallback(
    async (item: WorkItem, status: WorkItemStatus) => {
      const response = await fetch(`/api/work-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) return;
      const updated = (await response.json()) as WorkItem;
      setSelectedWorkItem(updated);
      await Promise.all([
        loadWorkItems(
          workItemRepositoryFilter === "active"
            ? (workspace?.context.id ?? "all")
            : workItemRepositoryFilter,
          workItemStatusFilter
        ),
        loadDashboard(workspace?.context.id),
      ]);
    },
    [
      loadDashboard,
      loadWorkItems,
      workItemRepositoryFilter,
      workItemStatusFilter,
      workspace?.context.id,
    ]
  );

  const loadSignals = useCallback(
    async (status = signalStatusFilter, source = signalSourceFilter) => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (source !== "all") params.set("source", source);
      const response = await fetch(`/api/incoming-signals?${params.toString()}`);
      const result = await requireOk<{ signals: IncomingSignal[] }>(response);
      setSignals(result.signals);
    },
    [signalSourceFilter, signalStatusFilter]
  );

  useEffect(() => {
    if (workspace?.context.id) void loadSignals().catch(() => setSignals([]));
  }, [loadSignals, workspace?.context.id]);

  const createSignal = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!workspace?.context.id || !signalTitle.trim()) return;
      const response = await fetch("/api/incoming-signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: signalSource,
          title: signalTitle,
          body: signalBody,
          repositoryId: workspace.context.id,
        }),
      });
      if (!response.ok) return;
      setSignalTitle("");
      setSignalBody("");
      await loadSignals(signalStatusFilter, signalSourceFilter);
    },
    [
      loadSignals,
      signalBody,
      signalSource,
      signalSourceFilter,
      signalStatusFilter,
      signalTitle,
      workspace?.context.id,
    ]
  );

  const updateSignalStatus = useCallback(
    async (signal: IncomingSignal, status: IncomingSignalStatus) => {
      const response = await fetch(`/api/incoming-signals/${signal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          snoozedUntil:
            status === "snoozed" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
          repositoryId: workspace?.context.id,
        }),
      });
      if (!response.ok) return;
      const updated = (await response.json()) as IncomingSignal;
      setSelectedSignal(updated);
      await loadSignals(signalStatusFilter, signalSourceFilter);
    },
    [loadSignals, signalSourceFilter, signalStatusFilter, workspace?.context.id]
  );

  const triageSignal = useCallback(
    async (signal: IncomingSignal, action: SignalTriageAction) => {
      setSignalTriageStatus("Applying triage action...");
      const response = await fetch(`/api/incoming-signals/${signal.id}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, repositoryId: workspace?.context.id }),
      });
      if (!response.ok) {
        setSignalTriageStatus("Triage action failed.");
        return;
      }
      const result = (await response.json()) as {
        signal: IncomingSignal;
        workItem?: WorkItem;
        skillRun?: { status: string };
        artifact?: ArtifactIndexEntry;
      };
      setSelectedSignal(result.signal);
      setSignalTriageStatus(
        result.workItem
          ? `Linked to work item: ${result.workItem.title}`
          : result.skillRun
            ? `Skill ${result.skillRun.status}.`
            : result.artifact
              ? `Artifact created: ${result.artifact.name}`
              : `${action.action.replaceAll("_", " ")} complete.`
      );
      await Promise.all([
        loadSignals(signalStatusFilter, signalSourceFilter),
        loadWorkItems(workspace?.context.id ?? "all", workItemStatusFilter),
        loadDashboard(workspace?.context.id),
      ]);
    },
    [
      loadDashboard,
      loadSignals,
      loadWorkItems,
      signalSourceFilter,
      signalStatusFilter,
      workItemStatusFilter,
      workspace?.context.id,
    ]
  );

  const inspectNode = useCallback((node: ClientGraphNode) => {
    setSelectedNode(node);
    setArtifactContent(null);
    setInspectorStatus(null);
  }, []);

  const runSkill = useCallback(
    async (skillId: string) => {
      setActionStatus("Running skill...");
      const response = await fetch(`/api/skills/${skillId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace?.context.id }),
      });
      setActionStatus(response.ok ? "Skill completed and artifact saved." : "Skill failed.");
      await loadDashboard(workspace?.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const runRoutine = useCallback(
    async (routineId: string) => {
      setActionStatus("Running routine...");
      const response = await fetch(`/api/routines/${routineId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace?.context.id }),
      });
      setActionStatus(response.ok ? "Routine completed." : "Routine failed.");
      await loadDashboard(workspace?.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const controlExecutor = useCallback(
    async (action: "start" | "stop" | "trigger") => {
      setActionStatus(
        action === "start"
          ? "Starting background routines..."
          : action === "stop"
            ? "Stopping background routines..."
            : "Checking due routines..."
      );
      const response = await fetch("/api/routines/executor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, repositoryId: workspace?.context.id }),
      });
      setActionStatus(
        response.ok
          ? `Background executor ${action === "trigger" ? "checked" : `${action}ed`}.`
          : "Background executor action failed."
      );
      if (response.ok) await loadDashboard(workspace?.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const inspectOperationalRun = useCallback(
    async (run: AutomationRun) => {
      setSelectedOperationalRun(run);
      setSelectedOperationalAudit(null);
      if (!workspace?.context.id) return;
      try {
        const result = await requireOk<{ audits: OperationalAuditRecord[] }>(
          await fetch(`/api/operational?repositoryId=${encodeURIComponent(workspace.context.id)}`)
        );
        setSelectedOperationalAudit(result.audits.find((audit) => audit.runId === run.id) ?? null);
      } catch {
        setInspectorStatus("Operational audit history could not be loaded.");
      }
    },
    [workspace?.context.id]
  );

  const setGlobalOperationalPause = useCallback(
    async (paused: boolean) => {
      if (!workspace?.context.id) return;
      const response = await fetch("/api/operational/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace.context.id, paused }),
      });
      if (response.ok) {
        setGlobalOperationalPaused(paused);
        setActionStatus(`Operational automation ${paused ? "paused" : "resumed"}.`);
        await loadDashboard(workspace.context.id);
      } else setActionStatus("Operational pause control failed.");
    },
    [loadDashboard, workspace?.context.id]
  );

  const updateOperationalRun = useCallback(
    async (run: AutomationRun, action: "approve" | "pause" | "resume" | "cancel") => {
      if (!workspace?.context.id) return;
      setInspectorStatus(
        `${action === "approve" ? "Approving" : `${action[0].toUpperCase()}${action.slice(1)}ing`} operational run...`
      );
      const response = await fetch(`/api/operational/runs/${run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          repositoryId: workspace.context.id,
          input: run.input,
          actor: "developer",
          providerAction: providerActionForRun(run),
        }),
      });
      if (!response.ok) {
        setInspectorStatus("Operational run update failed.");
        return;
      }
      const updated = (await response.json()) as AutomationRun;
      setSelectedOperationalRun(updated);
      setInspectorStatus(`Operational run ${updated.status.replace("_", " ")}.`);
      await loadDashboard(workspace.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const invokeOperationalAction = useCallback(
    async (run: AutomationRun) => {
      const providerAction = providerActionForRun(run);
      if (!workspace?.context.id || !providerAction) return;
      setInspectorStatus("Invoking approved provider action...");
      const response = await fetch(`/api/operational/runs/${run.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace.context.id, providerAction }),
      });
      if (!response.ok) {
        setInspectorStatus(
          ((await response.json()) as { error?: string }).error ?? "Provider action failed."
        );
        return;
      }
      const result = (await response.json()) as {
        action: { ok: boolean };
        audit: OperationalAuditRecord;
      };
      setSelectedOperationalAudit(result.audit);
      setSelectedOperationalRun({
        ...run,
        status: result.action.ok ? "succeeded" : "failed",
        outputs: [result.audit.id],
        error: result.action.ok ? null : "Provider action failed.",
      });
      setInspectorStatus(
        result.action.ok
          ? "Provider action completed and was audited."
          : "Provider action failed and was audited."
      );
      await loadDashboard(workspace.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const runInspectedSkill = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== "skill") return;
    await runSkill(selectedNode.id.replace("skill:", ""));
  }, [runSkill, selectedNode]);

  const openInspectedArtifact = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== "artifact") return;
    const repositoryQuery = workspace?.context.id
      ? `?repositoryId=${encodeURIComponent(workspace.context.id)}`
      : "";
    const response = await fetch(
      `/api/artifacts/${selectedNode.id.replace("artifact:", "")}${repositoryQuery}`
    );
    if (!response.ok) {
      setInspectorStatus("Artifact could not be loaded.");
      return;
    }
    const artifact = (await response.json()) as { content: unknown };
    setArtifactContent(
      typeof artifact.content === "string"
        ? artifact.content
        : JSON.stringify(artifact.content, null, 2)
    );
    setInspectorStatus(null);
  }, [selectedNode, workspace?.context.id]);

  const copyInspectedPath = useCallback(async () => {
    if (!selectedNode?.path) return;
    await navigator.clipboard.writeText(selectedNode.path);
    setInspectorStatus("Path copied.");
  }, [selectedNode]);

  const navigateInspectedNode = useCallback(async () => {
    if (!selectedNode) return;
    if (selectedNode.type === "repo") {
      const repositoryId = selectedNode.metadata?.repositoryId;
      if (typeof repositoryId === "string") await switchRepository(repositoryId);
      setInspectorStatus("Active repository context selected.");
      return;
    }
    if (selectedNode.type === "work_item") {
      const item = workItems.find(
        (candidate) => candidate.id === selectedNode.id.replace("work_item:", "")
      );
      if (item) {
        setSelectedWorkItem(item);
        setSelectedNode(null);
      } else setInspectorStatus("Work item is outside the current queue view.");
    }
  }, [selectedNode, switchRepository, workItems]);

  const graphNodes = graph?.nodes.length
    ? [
        ...graph.nodes.filter((node) =>
          ["repo", "work_item", "routine", "skill", "artifact"].includes(node.type)
        ),
        ...graph.nodes.filter(
          (node) => !["repo", "work_item", "routine", "skill", "artifact"].includes(node.type)
        ),
      ].slice(0, orbitIcons.length)
    : orbitIcons.map((_, index) => ({
        id: `placeholder:${index}`,
        type: "file" as const,
        label: `Node ${index + 1}`,
      }));

  return (
    <main
      className={`app-shell ${leftRailOpen ? "" : "left-rail-collapsed"} ${rightRailOpen ? "" : "right-rail-collapsed"}`}
      aria-label="Developer Agentic OS dashboard"
      style={
        {
          "--app-max-width": `${layout.pageWidth}px`,
          "--orbit-size": `${layout.orbitSize}px`,
        } as CSSProperties
      }
    >
      <aside className="rail" aria-label="Micro applications and calendar">
        <section
          className="module resizable-widget"
          data-resizable-id="micro-apps"
          ref={resizeRef("micro-apps")}
          style={resizableStyle("micro-apps", layout)}
          onPointerDown={(event) => markResizeStart("micro-apps", event.currentTarget)}
        >
          <ModuleHeading
            icon={Grip}
            title="Micro Apps"
            action={
              <OutlineButton>
                <Plus size={12} aria-hidden="true" /> Add App
              </OutlineButton>
            }
          />
          <div className="micro-list">
            {microApps.map(({ icon: Icon, title, description }) => (
              <button
                className={`micro-app ${(title === "Workspace Switcher" && workspaceSwitcherOpen) || (title === "Today / Focus Board" && focusBoardOpen) || (title === "Session Handoff" && handoffOpen) ? "active" : ""}`}
                key={title}
                type="button"
                aria-label={`${title}: ${description}`}
                aria-expanded={
                  title === "Workspace Switcher"
                    ? workspaceSwitcherOpen
                    : title === "Today / Focus Board"
                      ? focusBoardOpen
                      : title === "Session Handoff"
                        ? handoffOpen
                        : undefined
                }
                onClick={
                  title === "Workspace Switcher"
                    ? () => setWorkspaceSwitcherOpen((open) => !open)
                    : title === "Today / Focus Board"
                      ? () => setFocusBoardOpen((open) => !open)
                      : title === "Session Handoff"
                        ? () => setHandoffOpen((open) => !open)
                        : undefined
                }
              >
                <div className="app-icon">
                  <Icon size={14} aria-hidden="true" />
                </div>
                <div>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </div>
                <div className="signal-dots">---</div>
              </button>
            ))}
          </div>
          {workspaceSwitcherOpen ? (
            <div
              className="workspace-switcher-detail"
              id="workspace-switcher"
              aria-label="Workspace Switcher"
            >
              {workspaceLoading ? (
                <p className="dashboard-placeholder">Loading repositories...</p>
              ) : null}
              {workspaceError ? <p className="dashboard-banner error">{workspaceError}</p> : null}
              {workspace ? (
                <div className="repository-list" role="list" aria-label="Registered repositories">
                  {workspace.repositories.map((repository) => (
                    <button
                      className={`repository-option ${repository.id === workspace.context.id ? "active" : ""}`}
                      key={repository.id}
                      type="button"
                      aria-pressed={repository.id === workspace.context.id}
                      onClick={() => void switchRepository(repository.id)}
                    >
                      <span className="repository-main">
                        <strong>{repository.name}</strong>
                        <small>
                          {repository.git.available
                            ? (repository.git.currentBranch ?? "detached HEAD")
                            : "Git unavailable"}
                        </small>
                      </span>
                      <span className="repository-meta">
                        <span
                          className={`git-indicator ${repository.git.available ? "connected" : "unavailable"}`}
                          title={repository.git.message}
                          aria-label={
                            repository.git.available ? "Git available" : "Git unavailable"
                          }
                        />
                        <small>
                          {repository.git.available
                            ? `${repository.git.recentCommits.length} recent`
                            : "No activity"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {workspace?.repositories.length === 0 ? (
                <p className="dashboard-placeholder">No registered repositories.</p>
              ) : null}
            </div>
          ) : null}
          {handoffOpen ? (
            <section
              className="workspace-switcher-detail handoff-app"
              id="session-handoff"
              aria-label="Session Handoff"
            >
              <div className="handoff-app-header">
                <span className="tiny">{workspace?.context.name ?? "selected repository"}</span>
                <strong>Session Handoff</strong>
              </div>
              <form className="handoff-form" onSubmit={(event) => void createHandoff(event)}>
                <input
                  aria-label="Handoff title"
                  placeholder="Handoff title"
                  value={handoffTitle}
                  onChange={(event) => setHandoffTitle(event.target.value)}
                />
                <textarea
                  aria-label="Handoff decisions"
                  placeholder="Decisions, one per line"
                  value={handoffDecisions}
                  onChange={(event) => setHandoffDecisions(event.target.value)}
                />
                <textarea
                  aria-label="Handoff blockers"
                  placeholder="Blockers, one per line"
                  value={handoffBlockers}
                  onChange={(event) => setHandoffBlockers(event.target.value)}
                />
                <textarea
                  aria-label="Handoff next actions"
                  placeholder="Next actions, one per line"
                  value={handoffNextActions}
                  onChange={(event) => setHandoffNextActions(event.target.value)}
                />
                <button className="outline-button" type="submit">
                  <ClipboardPen size={12} aria-hidden="true" /> Create Draft
                </button>
              </form>
              <div className="handoff-list" aria-label="Handoff drafts">
                {handoffs.length === 0 ? (
                  <p className="dashboard-placeholder">No handoffs for this repository.</p>
                ) : (
                  handoffs.map((handoff) => (
                    <button
                      className="handoff-row"
                      type="button"
                      key={handoff.id}
                      onClick={() => selectHandoff(handoff)}
                    >
                      <span>
                        <strong>{handoff.title}</strong>
                        <small>
                          {handoff.status} / {handoff.snapshot.branch ?? "detached HEAD"}
                        </small>
                      </span>
                      <span className="tiny">{handoff.snapshot.changedFiles.length} files</span>
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </section>

        <section
          className="module resizable-widget"
          data-resizable-id="calendar"
          ref={resizeRef("calendar")}
          style={resizableStyle("calendar", layout)}
          onPointerDown={(event) => markResizeStart("calendar", event.currentTarget)}
        >
          <ModuleHeading
            icon={CalendarDays}
            title="Calendar"
            action={<OutlineButton>Open Cal</OutlineButton>}
          />
          <div className="clock-card">
            <div className="clock-face" aria-hidden="true" />
            <div>
              <div className="date-row">WK34 | Aug 20 2026 (Thu)</div>
              <div className="main-time">02:32:43 pm</div>
              <div className="caption">Aest synced</div>
            </div>
          </div>
          <div className="tz-row">
            <div className="tz">
              <strong>09:32 pm</strong>
              <span>USA PT</span>
            </div>
            <div className="tz">
              <strong>12:32 am</strong>
              <span>USA ET</span>
            </div>
            <div className="tz">
              <strong>05:32 am</strong>
              <span>London</span>
            </div>
          </div>
          <div className="quarter-grid" aria-label="Quarter heatmap">
            {Array.from({ length: 56 }, (_, index) => (
              <span
                className={`q-cell ${index === 25 ? "done" : index > 42 || index % 17 === 0 ? "dim" : ""}`}
                key={index}
              />
            ))}
          </div>
          <div className="agenda">
            <div className="agenda-row">
              <strong>Team standup</strong>
              <time>3:30pm</time>
            </div>
            <div className="agenda-row">
              <strong>Partnership intro - Nordic SaaS</strong>
              <time>5:00pm</time>
            </div>
            <div className="agenda-row">
              <strong>Team meet - sprint review</strong>
              <time>6:30pm</time>
            </div>
          </div>
        </section>

        <section
          className="module resizable-widget"
          data-resizable-id="artifacts"
          ref={resizeRef("artifacts")}
          style={resizableStyle("artifacts", layout)}
          onPointerDown={(event) => markResizeStart("artifacts", event.currentTarget)}
        >
          <ModuleHeading
            icon={Archive}
            title="Artifacts"
            action={<span className="tiny">{dashboard.artifacts.length} recent</span>}
          />
          <div className="artifact-strip" aria-label="Recent artifact activity">
            {dashboardLoading ? (
              <span className="dashboard-placeholder">Loading artifacts...</span>
            ) : null}
            {!dashboardLoading && dashboard.artifacts.length === 0 ? (
              <span className="dashboard-placeholder">No artifacts yet.</span>
            ) : null}
            {dashboard.artifacts.map((artifact, index) => (
              <button
                className={`artifact-dot ${index % 3 === 0 ? "hot" : index % 3 === 1 ? "active" : ""}`}
                key={artifact.id}
                title={artifact.name}
                type="button"
                onClick={() =>
                  inspectNode({
                    id: `artifact:${artifact.id}`,
                    type: "artifact",
                    label: artifact.name,
                    metadata: { artifactType: artifact.type, createdAt: artifact.createdAt },
                  })
                }
              >
                <span />
                <small>{artifact.name}</small>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="core" aria-label="Central workspace graph">
        <header className="brand">
          <div className="brand-mark">
            <span className="hex-mark" aria-hidden="true" />
            <h1>
              Developer <span>Agentic OS</span>
            </h1>
          </div>
          <p className="subtitle">Jay E | Developer Workspace</p>
          <nav className="toolbar" aria-label="Workspace controls">
            <AuthControls />
            <button type="button" aria-label="Search">
              <Search size={16} />
            </button>
            <button type="button" aria-label="Apps">
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              aria-label="Integration status"
              onClick={() => setIntegrationOpen((open) => !open)}
            >
              <Info size={16} />
            </button>
            <button
              type="button"
              aria-label={`${leftRailOpen ? "Collapse" : "Expand"} left rail`}
              onClick={() => setLeftRailOpen((open) => !open)}
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              type="button"
              aria-label={`${rightRailOpen ? "Collapse" : "Expand"} right rail`}
              onClick={() => setRightRailOpen((open) => !open)}
            >
              <PanelRightClose size={16} />
            </button>
            <button type="button" aria-label="Layout" onClick={() => setLayoutOpen(true)}>
              <SlidersHorizontal size={16} />
            </button>
          </nav>
          {integrationOpen ? (
            <div className="integration-popover" role="status" aria-label="Integration status">
              <div className="integration-popover-heading">
                <span>Operations health</span>
                <button
                  type="button"
                  aria-label="Refresh integration status"
                  title="Refresh integration status"
                  onClick={() => {
                    void loadDashboard(workspace?.context.id);
                    if (workspace?.context.id) {
                      void loadGitHubOperations(workspace.context.id);
                      void loadVercelOperations(workspace.context.id);
                    }
                  }}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
              {dashboardLoading ? (
                <span className="dashboard-placeholder">Loading integrations...</span>
              ) : null}
              {dashboard.integrations.map((integration) => (
                <div className="integration-row" key={integration.id}>
                  <div>
                    <span>{integration.name}</span>
                    <small>{integration.setup ?? integration.message}</small>
                  </div>
                  <b className={`integration-status ${integration.status}`}>{integration.status}</b>
                </div>
              ))}
              <div className="github-operations" aria-label="GitHub operations">
                <strong>GitHub operations</strong>
                {githubOperationsLoading ? (
                  <span className="dashboard-placeholder">Checking GitHub...</span>
                ) : null}
                {!githubOperationsLoading && githubOperations ? (
                  <>
                    <span className={`integration-status ${githubOperations.status}`}>
                      {githubOperations.message}
                    </span>
                    <span>
                      Issues: {githubOperations.issues.length} | PRs:{" "}
                      {githubOperations.pullRequests.length} | Actions:{" "}
                      {githubOperations.actions.length}
                    </span>
                    <span>Merge status: {githubOperations.mergeStatus.state}</span>
                    {githubOperations.issues.slice(0, 3).map((issue) => (
                      <a key={issue.number} href={issue.url} target="_blank" rel="noreferrer">
                        Issue #{issue.number}: {issue.title}
                      </a>
                    ))}
                    {githubOperations.pullRequests.slice(0, 3).map((pullRequest) => (
                      <a
                        key={pullRequest.number}
                        href={pullRequest.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PR #{pullRequest.number}: {pullRequest.title} ({pullRequest.mergeable})
                      </a>
                    ))}
                    {githubOperations.actions.slice(0, 3).map((action) => (
                      <a key={action.id} href={action.url} target="_blank" rel="noreferrer">
                        Action: {action.name} ({action.conclusion ?? action.status})
                      </a>
                    ))}
                  </>
                ) : null}
              </div>
              <div className="github-operations" aria-label="Vercel operations">
                <strong>Vercel operations</strong>
                {vercelOperationsLoading ? (
                  <span className="dashboard-placeholder">Checking Vercel...</span>
                ) : null}
                {!vercelOperationsLoading && vercelOperations ? (
                  <>
                    <span className={`integration-status ${vercelOperations.status}`}>
                      {vercelOperations.message}
                    </span>
                    <span>Deployments: {vercelOperations.deployments.length}</span>
                    {vercelOperations.deployments.slice(0, 3).map((deployment) => (
                      <span key={deployment.id} className="vercel-deployment">
                        <span>
                          {deployment.name} ({deployment.state})
                        </span>
                        <span>
                          <a href={deployment.buildLogUrl} target="_blank" rel="noreferrer">
                            Build logs
                          </a>{" "}
                          <a href={deployment.runtimeLogUrl} target="_blank" rel="noreferrer">
                            Runtime logs
                          </a>
                        </span>
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
              {!dashboardLoading && dashboard.integrations.length === 0 ? (
                <span className="dashboard-placeholder">No integration status available.</span>
              ) : null}
            </div>
          ) : null}
          {dashboardLoading ? <p className="dashboard-banner">Syncing workspace data...</p> : null}
          {dashboardError ? <p className="dashboard-banner error">{dashboardError}</p> : null}
          {actionStatus ? (
            <p className="dashboard-banner" role="status">
              {actionStatus}
            </p>
          ) : null}
        </header>
        <div className="orbital-stage">
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
                        : `Inspect ${node.label}`
                    }
                    onClick={() => inspectNode(node)}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <small>{String(index + 1).padStart(2, "0")}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <aside className="right-rail" aria-label="Agent Inbox, Email, skills, and routines">
        <section className="module work-queue-module" aria-label="Work Queue">
          <ModuleHeading
            icon={CheckCircle2}
            title="Work Queue"
            action={<span className="tiny">{workItems.length} visible</span>}
          />
          <form className="work-item-capture" onSubmit={(event) => void createWorkItem(event)}>
            <input
              aria-label="Work item title"
              placeholder="Capture a work item"
              value={workItemTitle}
              onChange={(event) => setWorkItemTitle(event.target.value)}
            />
            <textarea
              aria-label="Work item notes"
              placeholder="Notes (optional)"
              value={workItemNotes}
              onChange={(event) => setWorkItemNotes(event.target.value)}
            />
            <input
              aria-label="Work item due date"
              type="datetime-local"
              value={workItemDueAt}
              onChange={(event) => setWorkItemDueAt(event.target.value)}
            />
            <textarea
              aria-label="Work item context references"
              placeholder="References: file:path or skill:id (one per line)"
              value={workItemReferences}
              onChange={(event) => setWorkItemReferences(event.target.value)}
            />
            <div className="work-item-capture-row">
              <select
                aria-label="Work item priority"
                value={workItemPriority}
                onChange={(event) => setWorkItemPriority(event.target.value as WorkItemPriority)}
              >
                {(["low", "normal", "high", "urgent"] as const).map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <button className="outline-button" type="submit">
                <Plus size={12} aria-hidden="true" /> Capture
              </button>
            </div>
          </form>
          <div className="work-queue-filters">
            <select
              aria-label="Filter work items by repository"
              value={workItemRepositoryFilter}
              onChange={(event) => setWorkItemRepositoryFilter(event.target.value)}
            >
              <option value="active">Active repository</option>
              <option value="all">All repositories</option>
              {workspace?.repositories.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter work items by status"
              value={workItemStatusFilter}
              onChange={(event) =>
                setWorkItemStatusFilter(event.target.value as WorkItemStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {(["open", "in_progress", "blocked", "completed"] as const).map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="work-item-list" aria-label="Work items">
            {workItems.length === 0 ? (
              <p className="dashboard-placeholder">No work items in this view.</p>
            ) : null}
            {workItems.map((item) => (
              <button
                className={`work-item-row ${item.status}`}
                key={item.id}
                type="button"
                onClick={() => setSelectedWorkItem(item)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.priority} / {item.status.replace("_", " ")}
                  </small>
                </span>
                {item.status === "completed" ? (
                  <CheckCircle2 size={14} aria-label="Completed" />
                ) : null}
              </button>
            ))}
          </div>
        </section>
        {focusBoardOpen ? (
          <section className="module focus-board-module" aria-label="Today and Focus Board">
            <ModuleHeading
              icon={CheckCircle2}
              title="Today / Focus Board"
              action={
                <span className="tiny">{workspace?.context.name ?? "selected repository"}</span>
              }
            />
            {dashboardLoading && !dashboard.focusBoard ? (
              <p className="dashboard-placeholder">Loading today...</p>
            ) : null}
            {!dashboardLoading && !dashboard.focusBoard ? (
              <p className="dashboard-placeholder">Focus Board unavailable.</p>
            ) : null}
            {dashboard.focusBoard ? (
              <>
                <div className="focus-board-summary" aria-label="Focus Board summary">
                  <span>
                    <strong>{dashboard.focusBoard.workItems.length}</strong> active
                  </span>
                  <span>
                    <strong>{dashboard.focusBoard.dueWorkItems.length}</strong> due
                  </span>
                  <span>
                    <strong>{dashboard.focusBoard.blockedWorkItems.length}</strong> blocked
                  </span>
                  <span>
                    <strong>
                      {dashboard.focusBoard.failedSkillRuns.length +
                        dashboard.focusBoard.failedRoutineExecutions.length}
                    </strong>{" "}
                    failed
                  </span>
                  <span>
                    <strong>{dashboard.focusBoard.operationalIncidents.length}</strong> incidents
                  </span>
                  <span>
                    <strong>{dashboard.focusBoard.operationalRuns.length}</strong> automation
                  </span>
                </div>
                <div className="focus-board-section">
                  <span className="tiny">Attention now</span>
                  {dashboard.focusBoard.workItems.length === 0 ? (
                    <p className="dashboard-placeholder">No active work items.</p>
                  ) : (
                    dashboard.focusBoard.workItems.map((item) => (
                      <div className={`focus-board-row ${item.attention}`} key={item.id}>
                        <button
                          type="button"
                          className="focus-board-record"
                          onClick={() => setSelectedWorkItem(item)}
                        >
                          <strong>{item.title}</strong>
                          <small>
                            {item.attention.replace("_", " ")}{" "}
                            {item.dueAt ? ` / due ${formatFocusDate(item.dueAt)}` : ""}
                          </small>
                        </button>
                        <span className="focus-board-priority">{item.priority}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="focus-board-section">
                  <span className="tiny">
                    Operational attention{" "}
                    <button
                      className="outline-button"
                      type="button"
                      onClick={() => void setGlobalOperationalPause(!globalOperationalPaused)}
                    >
                      {globalOperationalPaused ? "Resume all" : "Pause all"}
                    </button>
                  </span>
                  {dashboard.focusBoard.operationalIncidents.length === 0 &&
                  dashboard.focusBoard.operationalRuns.length === 0 ? (
                    <p className="dashboard-placeholder">No operational attention.</p>
                  ) : null}
                  {dashboard.focusBoard.operationalIncidents.map((incident) => (
                    <button
                      className="focus-board-failure"
                      key={incident.id}
                      type="button"
                      onClick={() => setSelectedOperationalIncident(incident)}
                    >
                      <span>
                        <strong>{incident.title}</strong>
                        <small>
                          {incident.providers.join(", ")} / {incident.events.length} event(s)
                        </small>
                      </span>
                      <span className="focus-board-priority">incident</span>
                    </button>
                  ))}
                  {dashboard.focusBoard.operationalRuns.map((run) => (
                    <button
                      className="focus-board-failure"
                      data-run-id={run.id}
                      key={run.id}
                      type="button"
                      onClick={() => void inspectOperationalRun(run)}
                    >
                      <span>
                        <strong>Automation run</strong>
                        <small>
                          {run.status.replace("_", " ")}
                          {run.error ? ` / ${run.error}` : ""}
                        </small>
                      </span>
                      <span className="focus-board-priority">{run.retryCount} retries</span>
                    </button>
                  ))}
                </div>
                <div className="focus-board-section">
                  <span className="tiny">Recent artifacts</span>
                  {dashboard.focusBoard.recentArtifacts.length === 0 ? (
                    <p className="dashboard-placeholder">No recent artifacts.</p>
                  ) : (
                    dashboard.focusBoard.recentArtifacts.slice(0, 4).map((artifact) => (
                      <button
                        className="focus-board-link"
                        type="button"
                        key={artifact.id}
                        onClick={() =>
                          inspectNode({
                            id: `artifact:${artifact.id}`,
                            type: "artifact",
                            label: artifact.name,
                            metadata: {
                              artifactType: artifact.type,
                              createdAt: artifact.createdAt,
                            },
                          })
                        }
                      >
                        <Archive size={13} aria-hidden="true" />
                        <span>{artifact.name}</span>
                        <small>{formatFocusDate(artifact.createdAt)}</small>
                      </button>
                    ))
                  )}
                </div>
                <div className="focus-board-section">
                  <span className="tiny">Failed workflows</span>
                  {dashboard.focusBoard.failedSkillRuns.length === 0 &&
                  dashboard.focusBoard.failedRoutineExecutions.length === 0 ? (
                    <p className="dashboard-placeholder">No failed workflows.</p>
                  ) : null}
                  {dashboard.focusBoard.failedSkillRuns.map((run) => (
                    <div className="focus-board-failure" key={run.id}>
                      <span>
                        <strong>
                          {dashboard.skills.find((skill) => skill.id === run.skillId)?.command ??
                            run.skillId}
                        </strong>
                        <small>{run.error ?? "Skill failed"}</small>
                      </span>
                      <button
                        className="icon-button run"
                        type="button"
                        aria-label={`Run ${dashboard.skills.find((skill) => skill.id === run.skillId)?.command ?? run.skillId}`}
                        onClick={() => void runSkill(run.skillId)}
                      >
                        <Play size={13} />
                      </button>
                    </div>
                  ))}
                  {dashboard.focusBoard.failedRoutineExecutions.map((execution) => (
                    <div className="focus-board-failure" key={execution.id}>
                      <span>
                        <strong>{execution.routineName}</strong>
                        <small>{execution.error ?? "Routine failed"}</small>
                      </span>
                      <button
                        className="icon-button run"
                        type="button"
                        aria-label={`Run ${execution.routineName}`}
                        onClick={() => void runRoutine(execution.routineId)}
                      >
                        <Play size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        <section className="module agent-inbox-module" aria-label="Agent Inbox">
          <ModuleHeading
            icon={Inbox}
            title="Agent Inbox"
            action={<span className="tiny">{signals.length} visible</span>}
          />
          <form className="signal-capture" onSubmit={(event) => void createSignal(event)}>
            <input
              aria-label="Signal title"
              placeholder="Capture an incoming signal"
              value={signalTitle}
              onChange={(event) => setSignalTitle(event.target.value)}
            />
            <textarea
              aria-label="Signal body"
              placeholder="Signal details (optional)"
              value={signalBody}
              onChange={(event) => setSignalBody(event.target.value)}
            />
            <div className="signal-capture-row">
              <select
                aria-label="Signal source"
                value={signalSource}
                onChange={(event) => setSignalSource(event.target.value as IncomingSignalSource)}
              >
                <option value="manual">Manual note</option>
                <option value="email">Demo Email</option>
              </select>
              <button className="outline-button" type="submit">
                <Plus size={12} aria-hidden="true" /> Add signal
              </button>
            </div>
          </form>
          <div className="signal-filters">
            <select
              aria-label="Filter signals by source"
              value={signalSourceFilter}
              onChange={(event) =>
                setSignalSourceFilter(event.target.value as IncomingSignalSource | "all")
              }
            >
              <option value="all">All sources</option>
              <option value="manual">Manual</option>
              <option value="email">Email</option>
            </select>
            <select
              aria-label="Filter signals by status"
              value={signalStatusFilter}
              onChange={(event) =>
                setSignalStatusFilter(event.target.value as IncomingSignalStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              {(["new", "snoozed", "dismissed", "triaged"] as const).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="signal-list" aria-label="Incoming signals">
            {signals.length === 0 ? (
              <p className="dashboard-placeholder">No signals in this view.</p>
            ) : null}
            {signals.map((signal) => (
              <button
                className={`signal-row ${signal.status}`}
                key={signal.id}
                type="button"
                onClick={() => setSelectedSignal(signal)}
              >
                <span>
                  <strong>{signal.title}</strong>
                  <small>
                    {signal.source} / {signal.status}
                  </small>
                </span>
                <span className="signal-marker" />
              </button>
            ))}
          </div>
        </section>
        <section
          className="module resizable-widget"
          data-resizable-id="email"
          ref={resizeRef("email")}
          style={resizableStyle("email", layout)}
          onPointerDown={(event) => markResizeStart("email", event.currentTarget)}
        >
          <ModuleHeading
            icon={Mail}
            title="Email"
            action={<span className="tiny">updated 5m ago</span>}
          />
          <div className="email-count">
            <strong>47</strong>
            <span>
              Emails
              <br />
              past 24h
            </span>
          </div>
          <div className="caption">Flagged - needs Jay</div>
          <div className="mail-list">
            <div className="mail-item">
              <MailCheck size={13} />
              <strong>Sponsorship proposal - AI dev tools brand</strong>
              <time>2h</time>
            </div>
            <div className="mail-item">
              <MailCheck size={13} />
              <strong>Enterprise plan inquiry - 40 seats</strong>
              <time>4h</time>
            </div>
            <div className="mail-item">
              <MailCheck size={13} />
              <strong>Partnership newsletter cross-promo</strong>
              <time>7h</time>
            </div>
          </div>
          <div className="mix-bar">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="mix-legend">
            <span>9 partners</span>
            <span>14 leads</span>
            <span>6 personal</span>
            <span>18 other</span>
          </div>
          <p className="sync">Synced 02:36 PM - team@developer.local</p>
        </section>

        <section
          className="module resizable-widget"
          data-resizable-id="skills-deck"
          ref={resizeRef("skills-deck")}
          style={resizableStyle("skills-deck", layout)}
          onPointerDown={(event) => markResizeStart("skills-deck", event.currentTarget)}
        >
          <ModuleHeading
            icon={Zap}
            title="Skills Deck"
            action={
              <OutlineButton>
                <Plus size={12} aria-hidden="true" /> Add Skill
              </OutlineButton>
            }
          />
          <div className="skills-grid">
            {dashboardLoading ? (
              <span className="dashboard-placeholder">Loading skills...</span>
            ) : null}
            {!dashboardLoading && dashboard.skills.length === 0 ? (
              <span className="dashboard-placeholder">No skills available.</span>
            ) : null}
            {dashboard.skills.map((skill) => {
              const Icon = iconForSkill(skill.id);
              return (
                <article
                  className="skill-card resizable-widget"
                  data-resizable-id={`skill-${skill.id}`}
                  ref={resizeRef(`skill-${skill.id}`)}
                  style={resizableStyle(`skill-${skill.id}`, layout)}
                  onPointerDown={(event) =>
                    markResizeStart(`skill-${skill.id}`, event.currentTarget)
                  }
                  key={skill.id}
                >
                  <div>
                    <Icon className="skill-icon" size={22} aria-hidden="true" />
                    <strong className="skill-title">{skill.command}</strong>
                    <span>
                      <b className={`model ${skill.model.toLowerCase()}`}>{skill.model}</b>{" "}
                      <span className="effort">{skill.effort}</span>
                    </span>
                  </div>
                  <div className="skill-actions">
                    <button
                      className="icon-button run"
                      type="button"
                      aria-label={`Run ${skill.command}`}
                      onClick={() => void runSkill(skill.id)}
                    >
                      <Play size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Configure ${skill.command}`}
                      onClick={() => setConfiguredSkill(skill)}
                    >
                      <Settings size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section
          className="module resizable-widget"
          data-resizable-id="routines"
          ref={resizeRef("routines")}
          style={resizableStyle("routines", layout)}
          onPointerDown={(event) => markResizeStart("routines", event.currentTarget)}
        >
          <ModuleHeading
            icon={CircleDotDashed}
            title="Routines"
            action={
              <span className="routine-controls">
                <span className="tiny">
                  {dashboard.executor.running ? "background on" : "background off"}
                </span>
                <span className="routine-control-buttons">
                  <button
                    className="outline-button"
                    type="button"
                    onClick={() =>
                      void controlExecutor(dashboard.executor.running ? "stop" : "start")
                    }
                  >
                    {dashboard.executor.running ? "Stop" : "Start"}
                  </button>
                  <button
                    className="outline-button"
                    type="button"
                    onClick={() => void controlExecutor("trigger")}
                  >
                    Trigger
                  </button>
                </span>
              </span>
            }
          />
          <div className="routine-table">
            <div className="routine-header">
              <span>Time</span>
              <span>Routine</span>
              <span>Status</span>
            </div>
            {dashboardLoading ? (
              <div className="dashboard-placeholder">Loading routines...</div>
            ) : null}
            {!dashboardLoading && dashboard.routines.length === 0 ? (
              <div className="dashboard-placeholder">No routines available.</div>
            ) : null}
            {dashboard.routines.map((routine) => (
              <div className={`routine-row ${routine.status}`} key={routine.id}>
                <span className="time-chip">{routine.scheduleLabel}</span>
                <span>
                  <strong className="routine-name">
                    {routine.name}
                    <small className="routine-meta">
                      {routine.kind}{" "}
                      {routine.lastRunAt
                        ? `| last ${formatRoutineTime(routine.lastRunAt)}`
                        : "| not run"}{" "}
                      {routine.nextDueAt ? `| next ${formatRoutineTime(routine.nextDueAt)}` : ""}
                    </small>
                  </strong>
                </span>
                <span className="routine-actions">
                  <span className={`status ${routine.status === "next" ? "next" : ""}`}>
                    {routine.status}
                  </span>
                  {routine.kind === "built-in" ? (
                    <button
                      className="icon-button run"
                      type="button"
                      aria-label={`Run ${routine.name}`}
                      onClick={() => void runRoutine(routine.id)}
                    >
                      <Play size={13} />
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      </aside>
      {layoutOpen ? (
        <div className="layout-popover" role="presentation" onClick={() => setLayoutOpen(false)}>
          <section
            className="layout-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="layout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="layout-panel-header">
              <h3 id="layout-title">
                Layout <span>resize</span>
              </h3>
              <button
                className="icon-button"
                type="button"
                aria-label="Close layout controls"
                onClick={() => setLayoutOpen(false)}
              >
                x
              </button>
            </div>
            <label className="layout-control" htmlFor="page-width-control">
              <span>Page width</span>
              <output>{layout.pageWidth}px</output>
              <input
                id="page-width-control"
                type="range"
                min="1040"
                max="1680"
                step="20"
                value={layout.pageWidth}
                onChange={(event) => setPageWidth(Number(event.target.value))}
              />
            </label>
            <label className="layout-control" htmlFor="orbit-size-control">
              <span>Orbit size</span>
              <output>{layout.orbitSize}px</output>
              <input
                id="orbit-size-control"
                type="range"
                min="480"
                max="780"
                step="10"
                value={layout.orbitSize}
                onChange={(event) => setOrbitSize(Number(event.target.value))}
              />
            </label>
            <button className="reset-layout-button" type="button" onClick={resetLayout}>
              Reset Layout
            </button>
          </section>
        </div>
      ) : null}
      {configuredSkill ? (
        <div
          className="layout-popover"
          role="presentation"
          onClick={() => setConfiguredSkill(null)}
        >
          <section
            className="layout-panel skill-config-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-config-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="layout-panel-header">
              <h3 id="skill-config-title">
                {configuredSkill.command} <span>matrix</span>
              </h3>
              <button
                className="icon-button"
                type="button"
                aria-label="Close skill configuration"
                onClick={() => setConfiguredSkill(null)}
              >
                x
              </button>
            </div>
            <div className="model-effort-matrix" aria-label="Model by effort matrix">
              <span />
              {(["low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
                <strong key={effort}>{effort}</strong>
              ))}
              {(["sonnet", "opus", "fable"] as const).map((model) => (
                <div className="matrix-row" key={model}>
                  <b>{model}</b>
                  {(["low", "medium", "high", "xhigh", "max"] as const).map((effort) => (
                    <button
                      className={
                        configuredSkill.model === model && configuredSkill.effort === effort
                          ? "selected"
                          : ""
                      }
                      key={effort}
                      type="button"
                      aria-label={`${model} ${effort}`}
                      onClick={() => setConfiguredSkill({ ...configuredSkill, model, effort })}
                    >
                      +
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <p className="caption">
              Default: {configuredSkill.model} / {configuredSkill.effort}
            </p>
          </section>
        </div>
      ) : null}
      {selectedNode ? (
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
              onClick={() => setSelectedNode(null)}
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
              <button className="outline-button" type="button" onClick={openInspectedArtifact}>
                Open Artifact
              </button>
            ) : null}
            {selectedNode.type === "skill" ? (
              <button className="outline-button" type="button" onClick={runInspectedSkill}>
                Run Skill
              </button>
            ) : null}
            {selectedNode.type === "routine" ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => void runRoutine(selectedNode.id.replace("routine:", ""))}
              >
                Run Routine
              </button>
            ) : null}
            {selectedNode.type === "repo" || selectedNode.type === "work_item" ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => void navigateInspectedNode()}
              >
                {selectedNode.type === "repo" ? "Use Active Context" : "Open Work Item"}
              </button>
            ) : null}
            {selectedNode.type === "file" ? (
              <button className="outline-button" type="button" onClick={copyInspectedPath}>
                Copy Path
              </button>
            ) : null}
            {selectedNode.type === "repo" || selectedNode.type === "area" ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => window.location.reload()}
              >
                Refresh Graph
              </button>
            ) : null}
          </div>
          {inspectorStatus ? <p className="inspector-status">{inspectorStatus}</p> : null}
          {artifactContent !== null ? (
            <pre className="inspector-content">{artifactContent}</pre>
          ) : null}
        </aside>
      ) : null}
      {selectedWorkItem ? (
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
              onClick={() => setSelectedWorkItem(null)}
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
                  onClick={() => void updateWorkItemStatus(selectedWorkItem, status)}
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
      ) : null}
      {selectedOperationalRun ? (
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
              onClick={() => setSelectedOperationalRun(null)}
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
                onClick={() => void updateOperationalRun(selectedOperationalRun, "approve")}
              >
                Approve Run
              </button>
            ) : null}
            {selectedOperationalRun.status === "queued" &&
            providerActionForRun(selectedOperationalRun) ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => void invokeOperationalAction(selectedOperationalRun)}
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
                onClick={() => void updateOperationalRun(selectedOperationalRun, "pause")}
              >
                Pause
              </button>
            ) : null}
            {selectedOperationalRun.status === "paused" ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => void updateOperationalRun(selectedOperationalRun, "resume")}
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
                onClick={() => void updateOperationalRun(selectedOperationalRun, "cancel")}
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
                Recorded:{" "}
                <code>{new Date(selectedOperationalAudit.recordedAt).toLocaleString()}</code>
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
      ) : null}
      {selectedOperationalIncident ? (
        <aside className="inspector-panel" aria-label="Operational Incident Inspector">
          <div className="inspector-header">
            <div>
              <span className="tiny">
                operational incident / {selectedOperationalIncident.status}
              </span>
              <h3>{selectedOperationalIncident.title}</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close operational incident inspector"
              onClick={() => setSelectedOperationalIncident(null)}
            >
              x
            </button>
          </div>
          <p className="inspector-line">
            Incident ID: <code>{selectedOperationalIncident.id}</code>
          </p>
          <p className="inspector-line">
            Repository:{" "}
            <code>
              {workspace?.repositories.find(
                (repository) => repository.id === selectedOperationalIncident.repositoryId
              )?.name ?? selectedOperationalIncident.repositoryId}
            </code>
          </p>
          <p className="inspector-line">
            Created: <code>{new Date(selectedOperationalIncident.createdAt).toLocaleString()}</code>
          </p>
          <p className="inspector-line">
            Updated: <code>{new Date(selectedOperationalIncident.updatedAt).toLocaleString()}</code>
          </p>
          <p className="inspector-line">
            Providers: <code>{selectedOperationalIncident.providers.join(", ")}</code>
          </p>
          {selectedOperationalIncident.failure ? (
            <div className="work-history">
              <span className="tiny">Failure details</span>
              <p className="inspector-line">
                <code>{selectedOperationalIncident.failure.message}</code>
              </p>
              <pre className="inspector-content">
                {JSON.stringify(selectedOperationalIncident.failure.details ?? {}, null, 2)}
              </pre>
            </div>
          ) : null}
          <div className="work-history">
            <span className="tiny">
              Linked signals ({selectedOperationalIncident.signalIds.length})
            </span>
            {signals
              .filter((signal) => selectedOperationalIncident.signalIds.includes(signal.id))
              .map((signal) => (
                <p className="inspector-line" key={signal.id}>
                  <strong>{signal.title}</strong> <code>{signal.id}</code>
                </p>
              ))}
          </div>
          <div className="work-history">
            <span className="tiny">Evidence</span>
            {selectedOperationalIncident.events.map((event) => (
              <p className="inspector-line" key={event.id}>
                <strong>{event.title}</strong>{" "}
                <code>
                  {event.provider} / {event.sourceId ?? "no source id"} /{" "}
                  {new Date(event.observedAt).toLocaleString()}
                </code>
              </p>
            ))}
          </div>
        </aside>
      ) : null}
      {selectedSignal ? (
        <aside className="inspector-panel" aria-label="Agent Inbox Inspector">
          <div className="inspector-header">
            <div>
              <span className="tiny">
                {selectedSignal.source} / {selectedSignal.status}
              </span>
              <h3>{selectedSignal.title}</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close signal inspector"
              onClick={() => setSelectedSignal(null)}
            >
              x
            </button>
          </div>
          <p className="inspector-line">
            Repository Context ID: <code>{selectedSignal.repositoryId}</code>
          </p>
          <p className="inspector-line">
            Source ID: <code>{selectedSignal.sourceId ?? "none"}</code>
          </p>
          <p className="inspector-line">
            Received: <code>{new Date(selectedSignal.createdAt).toLocaleString()}</code>
          </p>
          <p className="inspector-line">
            Body: <code>{selectedSignal.body || "none"}</code>
          </p>
          <div className="inspector-actions">
            {(["triaged", "snoozed", "dismissed", "new"] as const)
              .filter((status) => status !== selectedSignal.status)
              .map((status) => (
                <button
                  className="outline-button"
                  key={status}
                  type="button"
                  onClick={() => void updateSignalStatus(selectedSignal, status)}
                >
                  {status}
                </button>
              ))}
          </div>
          <div className="signal-triage-actions">
            <span className="tiny">Triage actions</span>
            <button
              className="outline-button"
              type="button"
              onClick={() => void triageSignal(selectedSignal, { action: "create_work_item" })}
            >
              Create Work Item
            </button>
            {workItems.length ? (
              <>
                <select
                  aria-label="Existing work item for signal"
                  value={triageTargetId || workItems[0].id}
                  onChange={(event) => setTriageTargetId(event.target.value)}
                >
                  {workItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <button
                  className="outline-button"
                  type="button"
                  onClick={() =>
                    void triageSignal(selectedSignal, {
                      action: "attach_work_item",
                      workItemId: triageTargetId || workItems[0].id,
                    })
                  }
                >
                  Attach Work Item
                </button>
              </>
            ) : null}
            {dashboard.skills.some(
              (skill) => skill.kind === "built-in" && skill.inputs.length === 0
            ) ? (
              <button
                className="outline-button"
                type="button"
                onClick={() => {
                  const skill = dashboard.skills.find(
                    (item) => item.kind === "built-in" && item.inputs.length === 0
                  );
                  if (skill)
                    void triageSignal(selectedSignal, {
                      action: "invoke_skill",
                      skillId: skill.id,
                    });
                }}
              >
                Run Skill
              </button>
            ) : null}
            <button
              className="outline-button"
              type="button"
              onClick={() =>
                void triageSignal(selectedSignal, {
                  action: "create_artifact",
                  name: selectedSignal.title,
                  type: "signal_triage",
                  content: selectedSignal.body,
                })
              }
            >
              Create Artifact
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() => void triageSignal(selectedSignal, { action: "snooze" })}
            >
              Snooze
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() => void triageSignal(selectedSignal, { action: "dismiss" })}
            >
              Dismiss
            </button>
          </div>
          {signalTriageStatus ? (
            <p className="inspector-status" role="status">
              {signalTriageStatus}
            </p>
          ) : null}
        </aside>
      ) : null}
      {selectedHandoff ? (
        <aside className="inspector-panel" aria-label="Session Handoff Inspector">
          <div className="inspector-header">
            <div>
              <span className="tiny">session handoff / {selectedHandoff.status}</span>
              <h3>{selectedHandoff.title}</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close handoff inspector"
              onClick={() => setSelectedHandoff(null)}
            >
              x
            </button>
          </div>
          <p className="inspector-line">
            Repository: <code>{selectedHandoff.snapshot.repositoryContext.name}</code>
          </p>
          <p className="inspector-line">
            Branch: <code>{selectedHandoff.snapshot.branch ?? "detached HEAD"}</code>
          </p>
          <p className="inspector-line">
            Changed files: <code>{selectedHandoff.snapshot.changedFiles.length}</code>
          </p>
          <p className="inspector-line">
            Captured records:{" "}
            <code>
              {selectedHandoff.snapshot.workItems.length} work items /{" "}
              {selectedHandoff.snapshot.artifacts.length} artifacts /{" "}
              {selectedHandoff.snapshot.skillRuns.length} skill runs
            </code>
          </p>
          {selectedHandoff.status === "draft" ? (
            <div className="handoff-inspector-form">
              <input
                aria-label="Edit handoff title"
                value={handoffTitle}
                onChange={(event) => setHandoffTitle(event.target.value)}
              />
              <textarea
                aria-label="Edit handoff decisions"
                value={handoffDecisions}
                onChange={(event) => setHandoffDecisions(event.target.value)}
              />
              <textarea
                aria-label="Edit handoff blockers"
                value={handoffBlockers}
                onChange={(event) => setHandoffBlockers(event.target.value)}
              />
              <textarea
                aria-label="Edit handoff next actions"
                value={handoffNextActions}
                onChange={(event) => setHandoffNextActions(event.target.value)}
              />
              <div className="inspector-actions">
                <button className="outline-button" type="button" onClick={() => void saveHandoff()}>
                  Save Draft
                </button>
                <button
                  className="outline-button"
                  type="button"
                  onClick={() => void finalizeHandoff()}
                >
                  Finalize Handoff
                </button>
              </div>
            </div>
          ) : (
            <p className="inspector-status">
              Immutable Artifact: <code>{selectedHandoff.artifactId}</code>
            </p>
          )}
          {handoffStatus ? (
            <p className="inspector-status" role="status">
              {handoffStatus}
            </p>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}

function iconForNode(type: ClientGraphNode["type"]): LucideIcon {
  if (type === "repo") return Database;
  if (type === "area") return LayoutGrid;
  if (type === "artifact") return Archive;
  if (type === "skill") return Zap;
  if (type === "work_item") return CheckCircle2;
  if (type === "routine") return Timer;
  return FileText;
}

function iconForSkill(id: string): LucideIcon {
  if (id.includes("branch")) return GitBranch;
  if (id.includes("release")) return CircleDotDashed;
  if (id.includes("sprint")) return CalendarDays;
  return Zap;
}

function formatRoutineTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFocusDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}
