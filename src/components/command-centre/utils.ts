import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  CircleDotDashed,
  Database,
  FileText,
  GitBranch,
  LayoutGrid,
  Timer,
  Zap,
} from "lucide-react";
import type { AutomationRun } from "@/types/operational";
import type { ClientGraphNode, LayoutState } from "./types";

export function providerActionForRun(
  run: AutomationRun
): "github-rerun" | "vercel-redeploy" | null {
  if (typeof run.input.actionRunId === "string" && run.input.actionRunId) return "github-rerun";
  if (typeof run.input.deploymentId === "string" && run.input.deploymentId)
    return "vercel-redeploy";
  return null;
}

export function resizableStyle(id: string, layout: LayoutState): CSSProperties | undefined {
  const size = layout.widgetSizes[id];
  return size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined;
}

export function polarPosition(index: number, count: number): { x: number; y: number } {
  const angle = ((360 / Math.max(count, 1)) * index - 90) * (Math.PI / 180);
  const radius = 41;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

export async function requireOk<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export function iconForNode(type: ClientGraphNode["type"]): LucideIcon {
  if (type === "repo") return Database;
  if (type === "area") return LayoutGrid;
  if (type === "artifact") return Archive;
  if (type === "skill") return Zap;
  if (type === "work_item") return CheckCircle2;
  if (type === "routine") return Timer;
  return FileText;
}

export function iconForSkill(id: string): LucideIcon {
  if (id.includes("branch")) return GitBranch;
  if (id.includes("release")) return CircleDotDashed;
  if (id.includes("sprint")) return CalendarDays;
  return Zap;
}

export function formatRoutineTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFocusDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}
