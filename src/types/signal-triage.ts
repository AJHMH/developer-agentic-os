import type { ArtifactIndexEntry } from "./artifact";
import type { IncomingSignal } from "./incoming-signal";
import type { SkillRunRecord } from "./skill";
import type { WorkItem, WorkItemPriority } from "./work-item";

export type SignalTriageAction =
  | { action: "create_work_item"; title?: string; notes?: string; priority?: WorkItemPriority }
  | { action: "attach_work_item"; workItemId: string }
  | { action: "invoke_skill"; skillId: string; input?: Record<string, string> }
  | { action: "create_artifact"; name?: string; type?: string; content?: string; tags?: string[] }
  | { action: "dismiss" }
  | { action: "snooze"; snoozedUntil?: string };

export type SignalTriageResult = {
  action: SignalTriageAction["action"];
  signal: IncomingSignal;
  workItem?: WorkItem;
  skillRun?: SkillRunRecord;
  artifact?: ArtifactIndexEntry;
};
