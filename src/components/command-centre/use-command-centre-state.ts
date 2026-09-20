"use client";

import type { FormEvent } from "react";
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
import type {
  AutomationRun,
  OperationalAuditRecord,
  OperationalEvent,
  OperationalIncident,
} from "@/types/operational";
import type { ClientGraph, ClientGraphNode, DashboardData, WorkspaceData } from "./types";
import { baselineLayout, orbitIcons } from "./types";
import { providerActionForRun, requireOk } from "./utils";
import { usePersistedLayout, useResizePersistence } from "./use-command-centre-layout";

export function useCommandCentreState() {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(true);
  const [renderOrbitSize, setRenderOrbitSize] = useState(baselineLayout.orbitSize);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [focusBoardOpen, setFocusBoardOpen] = useState(true);
  const [secondBrainOpen, setSecondBrainOpen] = useState(false);
  const [secondBrainModalOpen, setSecondBrainModalOpen] = useState(false);
  const [secondBrainSearch, setSecondBrainSearch] = useState("");
  const [secondBrainTypeFilter, setSecondBrainTypeFilter] = useState<string>("all");
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
    (OperationalIncident & { events: OperationalEvent[] }) | null
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
    const clear = () => {
      activeResizeIds.current.clear();
      initialResizeSizes.current.clear();
    };
    window.addEventListener("pointerup", clear);
    return () => window.removeEventListener("pointerup", clear);
  }, []);

  const loadHandoffs = useCallback(async (repositoryId: string) => {
    const res = await fetch(`/api/handoffs?repositoryId=${encodeURIComponent(repositoryId)}`);
    const result = await requireOk<{ handoffs: Handoff[] }>(res);
    setHandoffs(result.handoffs);
  }, []);

  const loadDashboard = useCallback(async (repositoryId?: string) => {
    setDashboardLoading(true);
    setGitHubOperations(null);
    setVercelOperations(null);
    const cQ = repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : "";
    const aQ = repositoryId
      ? `?repositoryId=${encodeURIComponent(repositoryId)}&limit=6`
      : "?limit=6";
    const reqs = await Promise.allSettled([
      fetch(`/api/second-brain/graph${cQ}`).then((r) => requireOk<ClientGraph>(r)),
      fetch(`/api/artifacts${aQ}`).then((r) => requireOk<{ artifacts: ArtifactIndexEntry[] }>(r)),
      fetch("/api/skills").then((r) => requireOk<{ skills: SkillCommand[] }>(r)),
      fetch(`/api/routines${cQ}`).then((r) =>
        requireOk<{ routines: RoutineDefinition[]; executor: RoutineExecutorStatus }>(r)
      ),
      fetch(`/api/integrations${cQ}`).then((r) =>
        requireOk<{ integrations: IntegrationAdapterStatus[] }>(r)
      ),
      fetch(`/api/integrations/github${cQ}`).then((r) => requireOk<GitHubOperations>(r)),
      fetch(`/api/integrations/vercel${cQ}`).then((r) => requireOk<VercelOperations>(r)),
      fetch(`/api/focus-board${cQ}`).then((r) => requireOk<FocusBoard>(r)),
      fetch(`/api/operational${cQ}`).then((r) => requireOk<{ globalPaused: boolean }>(r)),
    ]);
    const [gR, artR, skR, roR, intR, ghR, vR, fbR, opR] = reqs;
    if (gR.status === "fulfilled") setGraph({ ...gR.value, links: gR.value.links ?? [] });
    setDashboard({
      artifacts: artR.status === "fulfilled" ? artR.value.artifacts : [],
      skills: skR.status === "fulfilled" ? skR.value.skills : [],
      routines: roR.status === "fulfilled" ? roR.value.routines : [],
      executor: roR.status === "fulfilled" ? roR.value.executor : dashboard.executor,
      integrations: intR.status === "fulfilled" ? intR.value.integrations : [],
      focusBoard: fbR.status === "fulfilled" ? fbR.value : null,
    });
    setGitHubOperations(ghR.status === "fulfilled" ? ghR.value : null);
    setVercelOperations(vR.status === "fulfilled" ? vR.value : null);
    if (opR.status === "fulfilled") setGlobalOperationalPaused(opR.value.globalPaused);
    setDashboardError(
      reqs.some((r) => r.status === "rejected") ? "Some workspace data could not be loaded." : null
    );
    setDashboardLoading(false);
  }, []);

  const loadGitHubOperations = useCallback(async (repositoryId: string) => {
    setGitHubOperationsLoading(true);
    try {
      setGitHubOperations(
        await fetch(
          `/api/integrations/github?repositoryId=${encodeURIComponent(repositoryId)}`
        ).then((r) => requireOk<GitHubOperations>(r))
      );
    } catch {
      setGitHubOperations(null);
    } finally {
      setGitHubOperationsLoading(false);
    }
  }, []);

  const loadVercelOperations = useCallback(async (repositoryId: string) => {
    setVercelOperationsLoading(true);
    try {
      setVercelOperations(
        await fetch(
          `/api/integrations/vercel?repositoryId=${encodeURIComponent(repositoryId)}`
        ).then((r) => requireOk<VercelOperations>(r))
      );
    } catch {
      setVercelOperations(null);
    } finally {
      setVercelOperationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!integrationOpen || !workspace?.context.id) return;
    if (!githubOperations) void loadGitHubOperations(workspace.context.id);
    if (!vercelOperations) void loadVercelOperations(workspace.context.id);
  }, [
    githubOperations,
    integrationOpen,
    loadGitHubOperations,
    loadVercelOperations,
    vercelOperations,
    workspace?.context.id,
  ]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      fetch("/api/workspace/context").then((r) => requireOk<{ context: RepositoryContext }>(r)),
      fetch("/api/workspace/repositories").then((r) =>
        requireOk<{ repositories: RepositorySwitcherEntry[] }>(r)
      ),
    ])
      .then(([ctx, repos]) => {
        if (!mounted) return;
        setWorkspace({ context: ctx.context, repositories: repos.repositories });
        setWorkspaceError(null);
        void loadDashboard(ctx.context.id);
        void loadHandoffs(ctx.context.id).catch(() => setHandoffs([]));
      })
      .catch(() => {
        if (mounted) setWorkspaceError("Workspace contexts could not be loaded.");
      })
      .finally(() => {
        if (mounted) setWorkspaceLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadDashboard, loadHandoffs]);

  const switchRepository = useCallback(
    async (id: string) => {
      if (!workspace || id === workspace.context.id) return;
      setWorkspaceError(null);
      try {
        const res = await fetch("/api/workspace/context", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const result = await requireOk<{ context: RepositoryContext }>(res);
        setWorkspace((c) => (c ? { ...c, context: result.context } : c));
        await Promise.all([loadDashboard(result.context.id), loadHandoffs(result.context.id)]);
      } catch {
        setWorkspaceError("Repository context could not be switched.");
      }
    },
    [loadDashboard, loadHandoffs, workspace]
  );

  const loadWorkItems = useCallback(
    async (repoId = workItemRepositoryFilter, st = workItemStatusFilter) => {
      const p = new URLSearchParams();
      if (repoId !== "all" && repoId !== "active") p.set("repositoryId", repoId);
      if (st !== "all") p.set("status", st);
      const result = await fetch(`/api/work-items?${p.toString()}`).then((r) =>
        requireOk<{ workItems: WorkItem[] }>(r)
      );
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
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!workspace?.context.id || !workItemTitle.trim()) return;
      const contextRefs = workItemReferences
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => {
          const [kind, ...refParts] = v.split(":");
          return { kind, ref: refParts.join(":").trim() };
        });
      const res = await fetch("/api/work-items", {
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
      if (!res.ok) return;
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
      const res = await fetch(`/api/work-items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setSelectedWorkItem((await res.json()) as WorkItem);
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
    async (st = signalStatusFilter, src = signalSourceFilter) => {
      const p = new URLSearchParams();
      if (st !== "all") p.set("status", st);
      if (src !== "all") p.set("source", src);
      const result = await fetch(`/api/incoming-signals?${p.toString()}`).then((r) =>
        requireOk<{ signals: IncomingSignal[] }>(r)
      );
      setSignals(result.signals);
    },
    [signalSourceFilter, signalStatusFilter]
  );

  useEffect(() => {
    if (workspace?.context.id) void loadSignals().catch(() => setSignals([]));
  }, [loadSignals, workspace?.context.id]);

  const createSignal = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!workspace?.context.id || !signalTitle.trim()) return;
      const res = await fetch("/api/incoming-signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: signalSource,
          title: signalTitle,
          body: signalBody,
          repositoryId: workspace.context.id,
        }),
      });
      if (!res.ok) return;
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
      const res = await fetch(`/api/incoming-signals/${signal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          snoozedUntil: status === "snoozed" ? new Date(Date.now() + 86400000).toISOString() : null,
          repositoryId: workspace?.context.id,
        }),
      });
      if (!res.ok) return;
      setSelectedSignal((await res.json()) as IncomingSignal);
      await loadSignals(signalStatusFilter, signalSourceFilter);
    },
    [loadSignals, signalSourceFilter, signalStatusFilter, workspace?.context.id]
  );

  const triageSignal = useCallback(
    async (signal: IncomingSignal, action: SignalTriageAction) => {
      setSignalTriageStatus("Applying triage action...");
      const res = await fetch(`/api/incoming-signals/${signal.id}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, repositoryId: workspace?.context.id }),
      });
      if (!res.ok) {
        setSignalTriageStatus("Triage action failed.");
        return;
      }
      const result = (await res.json()) as {
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
      const res = await fetch(`/api/skills/${skillId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace?.context.id }),
      });
      setActionStatus(res.ok ? "Skill completed and artifact saved." : "Skill failed.");
      await loadDashboard(workspace?.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const runRoutine = useCallback(
    async (routineId: string) => {
      setActionStatus("Running routine...");
      const res = await fetch(`/api/routines/${routineId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace?.context.id }),
      });
      setActionStatus(res.ok ? "Routine completed." : "Routine failed.");
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
      const res = await fetch("/api/routines/executor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, repositoryId: workspace?.context.id }),
      });
      setActionStatus(
        res.ok
          ? `Background executor ${action === "trigger" ? "checked" : `${action}ed`}.`
          : "Background executor action failed."
      );
      if (res.ok) await loadDashboard(workspace?.context.id);
    },
    [loadDashboard, workspace?.context.id]
  );

  const inspectOperationalRun = useCallback(
    async (run: AutomationRun) => {
      setSelectedOperationalRun(run);
      setSelectedOperationalAudit(null);
      if (!workspace?.context.id) return;
      try {
        const res = await requireOk<{ audits: OperationalAuditRecord[] }>(
          await fetch(`/api/operational?repositoryId=${encodeURIComponent(workspace.context.id)}`)
        );
        setSelectedOperationalAudit(res.audits.find((a) => a.runId === run.id) ?? null);
      } catch {
        setInspectorStatus("Operational audit history could not be loaded.");
      }
    },
    [workspace?.context.id]
  );

  const setGlobalOperationalPause = useCallback(
    async (paused: boolean) => {
      if (!workspace?.context.id) return;
      const res = await fetch("/api/operational/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace.context.id, paused }),
      });
      if (res.ok) {
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
      const res = await fetch(`/api/operational/runs/${run.id}`, {
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
      if (!res.ok) {
        setInspectorStatus("Operational run update failed.");
        return;
      }
      const updated = (await res.json()) as AutomationRun;
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
      const res = await fetch(`/api/operational/runs/${run.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryId: workspace.context.id, providerAction }),
      });
      if (!res.ok) {
        setInspectorStatus(
          ((await res.json()) as { error?: string }).error ?? "Provider action failed."
        );
        return;
      }
      const result = (await res.json()) as {
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

  const openInspectedArtifact = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== "artifact") return;
    const q = workspace?.context.id
      ? `?repositoryId=${encodeURIComponent(workspace.context.id)}`
      : "";
    const res = await fetch(`/api/artifacts/${selectedNode.id.replace("artifact:", "")}${q}`);
    if (!res.ok) {
      setInspectorStatus("Artifact could not be loaded.");
      return;
    }
    const artifact = (await res.json()) as { content: unknown };
    setArtifactContent(
      typeof artifact.content === "string"
        ? artifact.content
        : JSON.stringify(artifact.content, null, 2)
    );
    setInspectorStatus(null);
  }, [selectedNode, workspace?.context.id]);

  const navigateInspectedNode = useCallback(async () => {
    if (!selectedNode) return;
    if (selectedNode.type === "repo") {
      const repId = selectedNode.metadata?.repositoryId;
      if (typeof repId === "string") await switchRepository(repId);
      setInspectorStatus("Active repository context selected.");
      return;
    }
    if (selectedNode.type === "work_item") {
      const item = workItems.find((c) => c.id === selectedNode.id.replace("work_item:", ""));
      if (item) {
        setSelectedWorkItem(item);
        setSelectedNode(null);
      } else setInspectorStatus("Work item is outside the current queue view.");
    }
  }, [selectedNode, switchRepository, workItems]);

  const createHandoff = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!workspace?.context.id) return;
      setHandoffStatus("Capturing repository context...");
      const res = await fetch("/api/handoffs", {
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
      if (!res.ok) {
        setHandoffStatus("Draft could not be created.");
        return;
      }
      const handoff = (await res.json()) as Handoff;
      setHandoffs((c) => [handoff, ...c]);
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
    const res = await fetch(`/api/handoffs/${selectedHandoff.id}`, {
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
    if (!res.ok) {
      setHandoffStatus("Draft could not be saved.");
      return;
    }
    const handoff = (await res.json()) as Handoff;
    setHandoffs((c) => c.map((i) => (i.id === handoff.id ? handoff : i)));
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
    const res = await fetch(
      `/api/handoffs/${selectedHandoff.id}/finalize?repositoryId=${encodeURIComponent(workspace?.context.id ?? "")}`,
      { method: "POST" }
    );
    if (!res.ok) {
      setHandoffStatus("Handoff could not be finalized.");
      return;
    }
    const handoff = (await res.json()) as Handoff;
    setHandoffs((c) => c.map((i) => (i.id === handoff.id ? handoff : i)));
    setSelectedHandoff(handoff);
    setHandoffStatus("Finalized Handoff Artifact created.");
  }, [selectedHandoff, workspace?.context.id]);

  const filteredGraphNodes = (graph?.nodes ?? []).filter((node) => {
    if (secondBrainTypeFilter !== "all" && node.type !== secondBrainTypeFilter) return false;
    if (!secondBrainSearch.trim()) return true;
    const q = secondBrainSearch.toLowerCase();
    return (
      node.label.toLowerCase().includes(q) ||
      (node.path && node.path.toLowerCase().includes(q)) ||
      node.type.toLowerCase().includes(q)
    );
  });

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphNodes = nodes.length
    ? [
        ...nodes.filter((node) =>
          ["repo", "work_item", "routine", "skill", "artifact"].includes(node.type)
        ),
        ...nodes.filter(
          (node) => !["repo", "work_item", "routine", "skill", "artifact"].includes(node.type)
        ),
      ].slice(0, orbitIcons.length)
    : orbitIcons.map((_, index) => ({
        id: `placeholder:${index}`,
        type: "file" as const,
        label: `Node ${index + 1}`,
      }));

  return {
    layoutOpen,
    setLayoutOpen,
    leftRailOpen,
    setLeftRailOpen,
    rightRailOpen,
    setRightRailOpen,
    renderOrbitSize,
    orbitRef,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    focusBoardOpen,
    setFocusBoardOpen,
    secondBrainOpen,
    setSecondBrainOpen,
    secondBrainModalOpen,
    setSecondBrainModalOpen,
    secondBrainSearch,
    setSecondBrainSearch,
    secondBrainTypeFilter,
    setSecondBrainTypeFilter,
    handoffOpen,
    setHandoffOpen,
    integrationOpen,
    setIntegrationOpen,
    githubOperations,
    githubOperationsLoading,
    loadGitHubOperations,
    vercelOperations,
    vercelOperationsLoading,
    loadVercelOperations,
    graph,
    graphNodes,
    filteredGraphNodes,
    dashboard,
    dashboardLoading,
    dashboardError,
    loadDashboard,
    actionStatus,
    configuredSkill,
    setConfiguredSkill,
    selectedNode,
    setSelectedNode,
    inspectNode,
    selectedOperationalRun,
    setSelectedOperationalRun,
    inspectOperationalRun,
    updateOperationalRun,
    invokeOperationalAction,
    selectedOperationalIncident,
    setSelectedOperationalIncident,
    selectedOperationalAudit,
    globalOperationalPaused,
    setGlobalOperationalPause,
    artifactContent,
    inspectorStatus,
    setInspectorStatus,
    workspace,
    workspaceLoading,
    workspaceError,
    switchRepository,
    workItems,
    workItemStatusFilter,
    setWorkItemStatusFilter,
    workItemRepositoryFilter,
    setWorkItemRepositoryFilter,
    selectedWorkItem,
    setSelectedWorkItem,
    workItemTitle,
    setWorkItemTitle,
    workItemNotes,
    setWorkItemNotes,
    workItemPriority,
    setWorkItemPriority,
    workItemDueAt,
    setWorkItemDueAt,
    workItemReferences,
    setWorkItemReferences,
    createWorkItem,
    updateWorkItemStatus,
    signals,
    signalStatusFilter,
    setSignalStatusFilter,
    signalSourceFilter,
    setSignalSourceFilter,
    selectedSignal,
    setSelectedSignal,
    signalSource,
    setSignalSource,
    signalTitle,
    setSignalTitle,
    signalBody,
    setSignalBody,
    triageTargetId,
    setTriageTargetId,
    signalTriageStatus,
    createSignal,
    updateSignalStatus,
    triageSignal,
    handoffs,
    selectedHandoff,
    setSelectedHandoff,
    handoffTitle,
    setHandoffTitle,
    handoffDecisions,
    setHandoffDecisions,
    handoffBlockers,
    setHandoffBlockers,
    handoffNextActions,
    setHandoffNextActions,
    handoffStatus,
    createHandoff,
    selectHandoff,
    saveHandoff,
    finalizeHandoff,
    runSkill,
    runRoutine,
    controlExecutor,
    openInspectedArtifact,
    navigateInspectedNode,
    layout,
    setPageWidth,
    setOrbitSize,
    resetLayout,
    resizeRef,
    markResizeStart,
  };
}
