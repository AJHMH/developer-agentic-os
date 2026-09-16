# 35: Repository Automation Policies

**What to build:** A developer can inspect and configure repository-local Automation Policies controlling enabled triggers, workflows, approval requirements, retry limits, and catch-up behavior without storing credentials.

**Blocked by:** 33: Operational Event Contract

**Status:** closed

- [x] Policies define schedule and provider-event triggers.
- [x] Policies select eligible workflows and required approval behavior.
- [x] Policies define bounded retry and restart catch-up limits.
- [x] Policies can be enabled, disabled, inspected, and validated.
- [x] Policy data is scoped to a Repository Context and contains no credentials.
- [x] Unit, route, and browser tests cover valid, invalid, disabled, and cross-repository policies.
