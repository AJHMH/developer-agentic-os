"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Plus,
  RefreshCw,
  Sparkles,
  Workflow,
} from "lucide-react";

import type { SkillCommand } from "@/types/skill";
import type { HostedWorkspace } from "@/types/hosted-workspace";
import type { WorkItemPriority, WorkItemStatus } from "@/types/work-item";
import { AuthControls } from "./auth-controls";

type HostedView = "focus" | "queue" | "skills" | "routines" | "workspaces";

type HostedWorkItem = {
  id: string;
  title: string;
  notes?: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt?: string | null;
  createdAt: string;
};

type HostedRecords = {
  workItems?: HostedWorkItem[];
  automationRuns?: Array<{ id: string; description?: string; status?: string; createdAt?: string }>;
};

const views: Array<{ id: HostedView; label: string; icon: typeof CheckCircle2 }> = [
  { id: "focus", label: "Today", icon: CheckCircle2 },
  { id: "queue", label: "Work Queue", icon: ClipboardList },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "routines", label: "Routines", icon: Workflow },
  { id: "workspaces", label: "Workspaces", icon: Layers3 },
];

const hostedRoutines = [
  {
    id: "daily-focus",
    name: "Daily focus review",
    description: "Record a hosted review of the current work queue.",
  },
  {
    id: "workspace-health",
    name: "Workspace health check",
    description: "Record a hosted operational health check.",
  },
];

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
  return body;
}

export function HostedCommandCentre({ fixtureMode = false }: { fixtureMode?: boolean }) {
  const [view, setView] = useState<HostedView>("focus");
  const [workspaces, setWorkspaces] = useState<HostedWorkspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<HostedWorkspace | null>(null);
  const [records, setRecords] = useState<HostedRecords>({});
  const [skills, setSkills] = useState<SkillCommand[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<WorkItemPriority>("normal");
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturingWorkItem, setCapturingWorkItem] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const capturingWorkItemRef = useRef(false);
  const creatingWorkspaceRef = useRef(false);
  const selectionSequence = useRef(0);
  const selectionQueue = useRef<Promise<void>>(Promise.resolve());

  const fetchRecords = useCallback(async (workspaceId: string) => {
    const result = await fetch(
      `/api/hosted/domain?workspaceId=${encodeURIComponent(workspaceId)}&view=records`
    ).then((response) => responseJson<{ records: HostedRecords }>(response));
    return result.records;
  }, []);

  const refreshRecords = useCallback(
    async (workspaceId: string) => {
      setRecords(await fetchRecords(workspaceId));
    },
    [fetchRecords]
  );

  const load = useCallback(async () => {
    const requestSequence = ++selectionSequence.current;
    setLoading(true);
    setError(null);
    setSkillsError(null);
    void fetch("/api/skills")
      .then((response) => responseJson<{ skills: SkillCommand[] }>(response))
      .then((result) => setSkills(result.skills))
      .catch(() => {
        setSkills([]);
        setSkillsError("Skills could not be loaded.");
      });
    try {
      const workspaceResult = await fetch("/api/hosted/workspaces").then((response) =>
        responseJson<{ workspaces: HostedWorkspace[]; activeWorkspace: HostedWorkspace }>(response)
      );
      const nextRecords = await fetchRecords(workspaceResult.activeWorkspace.id);
      if (requestSequence !== selectionSequence.current) return;
      setWorkspaces(workspaceResult.workspaces);
      setActiveWorkspace(workspaceResult.activeWorkspace);
      setRecords(nextRecords);
    } catch (loadError) {
      if (requestSequence !== selectionSequence.current) return;
      setError(
        loadError instanceof Error ? loadError.message : "Hosted workspace could not be loaded."
      );
    } finally {
      if (requestSequence === selectionSequence.current) setLoading(false);
    }
  }, [fetchRecords]);

  useEffect(() => {
    void load();
  }, [load]);

  const captureWorkItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (capturingWorkItemRef.current || !activeWorkspace || !title.trim()) return;
    capturingWorkItemRef.current = true;
    setCapturingWorkItem(true);
    setStatus("Capturing work item...");
    try {
      await fetch("/api/hosted/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create-work-item",
          workspaceId: activeWorkspace.id,
          title,
          notes,
          priority,
        }),
      }).then((response) => responseJson(response));
      setTitle("");
      setNotes("");
      setPriority("normal");
      await refreshRecords(activeWorkspace.id);
      setStatus("Work item captured.");
    } catch (captureError) {
      setStatus(
        captureError instanceof Error ? captureError.message : "Work item could not be captured."
      );
    } finally {
      capturingWorkItemRef.current = false;
      setCapturingWorkItem(false);
    }
  };

  const selectWorkspace = async (workspace: HostedWorkspace) => {
    const requestSequence = ++selectionSequence.current;
    setStatus(`Opening ${workspace.name}...`);
    const operation = selectionQueue.current.then(async () => {
      try {
        await fetch(`/api/hosted/workspaces/${workspace.id}/select`, { method: "POST" }).then(
          (response) => responseJson(response)
        );
        const nextRecords = await fetchRecords(workspace.id);
        if (requestSequence !== selectionSequence.current) return;
        setActiveWorkspace(workspace);
        setRecords(nextRecords);
        setStatus(`${workspace.name} is active.`);
      } catch (selectError) {
        if (requestSequence !== selectionSequence.current) return;
        setStatus(
          selectError instanceof Error ? selectError.message : "Workspace could not be selected."
        );
      }
    });
    selectionQueue.current = operation.catch(() => undefined);
    await operation;
  };

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingWorkspaceRef.current || !workspaceName.trim()) return;
    creatingWorkspaceRef.current = true;
    setCreatingWorkspace(true);
    try {
      const result = await fetch("/api/hosted/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      }).then((response) => responseJson<{ workspace: HostedWorkspace }>(response));
      setWorkspaces((current) => [...current, result.workspace]);
      setWorkspaceName("");
      await selectWorkspace(result.workspace);
    } catch (createError) {
      setStatus(
        createError instanceof Error ? createError.message : "Workspace could not be created."
      );
    } finally {
      creatingWorkspaceRef.current = false;
      setCreatingWorkspace(false);
    }
  };

  const runRoutine = async (routine: (typeof hostedRoutines)[number]) => {
    if (!activeWorkspace) return;
    setStatus(`Running ${routine.name}...`);
    try {
      await fetch("/api/hosted/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "hosted-safe-work",
          workspaceId: activeWorkspace.id,
          description: routine.description,
        }),
      }).then((response) => responseJson(response));
      await refreshRecords(activeWorkspace.id);
      setStatus(`${routine.name} completed.`);
    } catch (routineError) {
      setStatus(routineError instanceof Error ? routineError.message : "Routine failed.");
    }
  };

  const workItems = records.workItems ?? [];
  const focusItems = workItems
    .filter((item) => item.status !== "completed")
    .sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority))
    .slice(0, 5);

  return (
    <main className="hosted-shell">
      <header className="hosted-header">
        <div>
          <p className="caption">Hosted command centre</p>
          <h1>Developer Workflow OS</h1>
        </div>
        <div className="hosted-account">
          <span>{activeWorkspace?.name ?? "Loading workspace"}</span>
          {fixtureMode ? <span>Fixture user</span> : <AuthControls />}
        </div>
      </header>

      <nav className="hosted-nav" aria-label="Micro applications">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            aria-pressed={view === id}
            className={view === id ? "active" : ""}
            key={id}
            type="button"
            onClick={() => setView(id)}
          >
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      {status ? (
        <p className="hosted-status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <section className="hosted-error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </section>
      ) : null}
      {loading ? <p className="hosted-loading">Loading your workspace...</p> : null}

      {!loading && !error ? (
        <div className="hosted-content">
          {view === "focus" ? (
            <section className="hosted-view">
              <ViewHeading
                title="Today / Focus Board"
                detail={`${focusItems.length} active priorities`}
              />
              <div className="hosted-list">
                {focusItems.map((item) => (
                  <WorkItemRow item={item} key={item.id} />
                ))}
                {!focusItems.length ? (
                  <EmptyState text="Your focus board is clear. Capture a work item to begin." />
                ) : null}
              </div>
            </section>
          ) : null}

          {view === "queue" ? (
            <section className="hosted-view hosted-queue-grid">
              <div>
                <ViewHeading title="Work Queue" detail={`${workItems.length} captured`} />
                <div className="hosted-list">
                  {workItems.map((item) => (
                    <WorkItemRow item={item} key={item.id} />
                  ))}
                  {!workItems.length ? (
                    <EmptyState text="No work items have been captured yet." />
                  ) : null}
                </div>
              </div>
              <form className="hosted-capture" onSubmit={(event) => void captureWorkItem(event)}>
                <h2>Capture</h2>
                <label>
                  Title
                  <input
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
                <label>
                  Priority
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as WorkItemPriority)}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <button className="hosted-primary" type="submit" disabled={capturingWorkItem}>
                  <Plus size={15} aria-hidden="true" />{" "}
                  {capturingWorkItem ? "Capturing..." : "Capture work item"}
                </button>
              </form>
            </section>
          ) : null}

          {view === "skills" ? (
            <section className="hosted-view">
              <ViewHeading title="Skills" detail={`${skills.length} available`} />
              <div className="hosted-list hosted-skill-grid">
                {skills.map((skill) => (
                  <article className="hosted-row" key={skill.id}>
                    <div>
                      <strong>{skill.label}</strong>
                      <p>{skill.description}</p>
                    </div>
                    <span className={`hosted-tag ${skill.status}`}>{skill.status}</span>
                  </article>
                ))}
                {!skills.length ? (
                  <EmptyState
                    text={skillsError ?? "No skills are registered in this deployment."}
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {view === "routines" ? (
            <section className="hosted-view">
              <ViewHeading
                title="Hosted Routines"
                detail={`${records.automationRuns?.length ?? 0} runs recorded`}
              />
              <div className="hosted-list">
                {hostedRoutines.map((routine) => (
                  <article className="hosted-row" key={routine.id}>
                    <div>
                      <strong>{routine.name}</strong>
                      <p>{routine.description}</p>
                    </div>
                    <button type="button" onClick={() => void runRoutine(routine)}>
                      Run
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {view === "workspaces" ? (
            <section className="hosted-view hosted-queue-grid">
              <div>
                <ViewHeading title="Workspaces" detail={`${workspaces.length} private`} />
                <div className="hosted-list">
                  {workspaces.map((workspace) => (
                    <button
                      className={`hosted-workspace-row ${workspace.id === activeWorkspace?.id ? "active" : ""}`}
                      key={workspace.id}
                      type="button"
                      onClick={() => void selectWorkspace(workspace)}
                    >
                      <BriefcaseBusiness size={17} aria-hidden="true" />
                      <span>
                        <strong>{workspace.name}</strong>
                        <small>
                          {workspace.id === activeWorkspace?.id ? "Active" : "Open workspace"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <form className="hosted-capture" onSubmit={(event) => void createWorkspace(event)}>
                <h2>New workspace</h2>
                <label>
                  Name
                  <input
                    required
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                  />
                </label>
                <button className="hosted-primary" type="submit" disabled={creatingWorkspace}>
                  <Plus size={15} aria-hidden="true" />{" "}
                  {creatingWorkspace ? "Creating..." : "Create workspace"}
                </button>
              </form>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function ViewHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="hosted-view-heading">
      <div>
        <p className="caption">Active workspace</p>
        <h2>{title}</h2>
      </div>
      <span>{detail}</span>
    </div>
  );
}

function WorkItemRow({ item }: { item: HostedWorkItem }) {
  return (
    <article className="hosted-row">
      <div>
        <strong>{item.title}</strong>
        {item.notes ? <p>{item.notes}</p> : null}
      </div>
      <span className={`hosted-tag ${item.priority}`}>{item.priority}</span>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="hosted-empty">{text}</p>;
}

function priorityRank(priority: WorkItemPriority): number {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[priority];
}
