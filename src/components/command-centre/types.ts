import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BarChart3,
  CircleDotDashed,
  Database,
  FileText,
  GitBranch,
  Globe,
  Info,
  LayoutGrid,
  Mail,
  MailCheck,
  Monitor,
  Play,
  Route,
  Search,
  Timer,
  Zap,
  CheckCircle2,
  ClipboardPen,
} from "lucide-react";
import type { ArtifactIndexEntry } from "@/types/artifact";
import type { IntegrationAdapterStatus } from "@/types/integration";
import type { RoutineDefinition, RoutineExecutorStatus } from "@/types/routine";
import type { SkillCommand } from "@/types/skill";
import type { RepositoryContext, RepositorySwitcherEntry } from "@/types/workspace";
import type { FocusBoard } from "@/types/focus-board";

export type MicroAppEntry = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export const microApps: MicroAppEntry[] = [
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

export type DashboardData = {
  artifacts: ArtifactIndexEntry[];
  skills: SkillCommand[];
  routines: RoutineDefinition[];
  executor: RoutineExecutorStatus;
  integrations: IntegrationAdapterStatus[];
  focusBoard: FocusBoard | null;
};

export type WorkspaceData = {
  context: RepositoryContext;
  repositories: RepositorySwitcherEntry[];
};

export type LayoutState = {
  pageWidth: number;
  orbitSize: number;
  widgetSizes: Record<string, { width: number; height: number }>;
};

export type ClientGraphNode = {
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

export type ClientGraphLink = {
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

export type ClientGraph = {
  nodes: ClientGraphNode[];
  links: ClientGraphLink[];
};

export const layoutStorageKey = "developer-agentic-os-layout-v1";
export const baselineLayout: LayoutState = { pageWidth: 1480, orbitSize: 660, widgetSizes: {} };

export const orbitIcons: LucideIcon[] = [
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
