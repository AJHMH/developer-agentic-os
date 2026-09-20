# src/types/focus-board.ts

- FocusBoardWorkItem · type · L7-L9 — type FocusBoardWorkItem = WorkItem & { attention: "open" | "in_progress" | "due" | "overdue" | "blocked"; };
- FocusBoardRoutineFailure · type · L11-L13 — type FocusBoardRoutineFailure = RoutineExecutionRecord & { routineName: string; };
- FocusBoard · type · L15-L29 — type FocusBoard = { repositoryId: string; generatedAt: string; workItems: FocusBoardWorkItem[]; dueWorkItems: FocusBoardWorkItem[]; overdueWorkItems: FocusBoardWorkItem[]; blockedWorkItems: FocusBoardWorkItem[]; recentArtifacts: ArtifactIndexEntry[]; failedSkillRuns: SkillRunRecord[]; failedRoutineExecutions: FocusBoardRoutineFailure[]; operationalIncidents: Array< OperationalIncident & { events: import("./operational").OperationalEvent[] } >; operationalRuns: AutomationRun[]; };
