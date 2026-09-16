# 36: Local Scheduled Automation

**What to build:** An explicitly enabled local executor runs a scheduled diagnostic workflow, displays its lifecycle, persists its Automation Run, and produces linked local outputs.

**Blocked by:** 33: Operational Event Contract; 35: Repository Automation Policies

**Status:** closed

- [x] The local executor can be explicitly enabled and disabled.
- [x] A configured schedule queues and runs an eligible workflow for the correct Repository Context.
- [x] The Automation Run exposes queued, running, succeeded, and failed state with timestamps and reasons.
- [x] A successful run produces linked Skill Run, Artifact, or Work Item outputs through existing boundaries.
- [x] A failed run preserves error detail and creates or updates an Incoming Signal.
- [x] Unit, route, and browser tests demonstrate one complete scheduled workflow.
