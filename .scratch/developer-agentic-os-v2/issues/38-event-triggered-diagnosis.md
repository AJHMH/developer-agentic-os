# 38: Event-Triggered Diagnosis

**What to build:** A Sentry, GitHub, or Vercel failure creates or updates an Operational Incident, invokes a typed diagnostic Skill, and produces a linked Artifact, Skill Run, or Work Item.

**Blocked by:** 34: Operational Incident Grouping; 36: Local Scheduled Automation; 37: Sentry Event Ingestion

**Status:** closed

- [x] A provider failure can trigger an eligible diagnostic workflow.
- [x] The workflow creates or attaches an Incoming Signal and Operational Incident.
- [x] Diagnosis invokes a Skill through the existing Skill Registry.
- [x] Diagnostic outputs retain event, signal, Incident, and Repository Context provenance.
- [x] Diagnostic failure is visible and does not masquerade as successful recovery.
- [x] Unit, route, and browser tests demonstrate one complete event-triggered diagnosis path.
