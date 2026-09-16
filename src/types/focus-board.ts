import type { ArtifactIndexEntry } from "./artifact";
import type { RoutineExecutionRecord } from "./routine";
import type { SkillRunRecord } from "./skill";
import type { WorkItem } from "./work-item";
import type { AutomationRun, OperationalIncident } from "./operational";

export type FocusBoardWorkItem = WorkItem & {
  attention: "open" | "in_progress" | "due" | "overdue" | "blocked";
};

export type FocusBoardRoutineFailure = RoutineExecutionRecord & {
  routineName: string;
};

export type FocusBoard = {
  repositoryId: string;
  generatedAt: string;
  workItems: FocusBoardWorkItem[];
  dueWorkItems: FocusBoardWorkItem[];
  overdueWorkItems: FocusBoardWorkItem[];
  blockedWorkItems: FocusBoardWorkItem[];
  recentArtifacts: ArtifactIndexEntry[];
  failedSkillRuns: SkillRunRecord[];
  failedRoutineExecutions: FocusBoardRoutineFailure[];
  operationalIncidents: Array<
    OperationalIncident & { events: import("./operational").OperationalEvent[] }
  >;
  operationalRuns: AutomationRun[];
};
