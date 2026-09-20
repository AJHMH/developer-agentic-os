# src/server/focus-board/focus-board.ts

- FocusBoardOptions · type · L11-L16 — type FocusBoardOptions = { context?: WorkspaceContext; now?: () => Date; limit?: number; workItems?: WorkItemStore; };
- getFocusBoard · function · L22-L102 — async function getFocusBoard( repositoryId: string, repositoryRoot: string, options: FocusBoardOptions = {} ): Promise<FocusBoard>
- attentionRank · function · L104-L106 — function attentionRank(item: FocusBoardWorkItem): number
- attentionFor · function · L108-L113 — function attentionFor(item: WorkItem, nowValue: number): FocusBoardWorkItem["attention"]
- priorityRank · function · L115-L117 — function priorityRank(priority: FocusBoardWorkItem["priority"]): number
- buildHostedFocusBoard · function · L119-L154 — function buildHostedFocusBoard( repositoryId: string, records: { workItems?: WorkItem[]; artifacts?: unknown[] }, limit = 12 ): FocusBoard
