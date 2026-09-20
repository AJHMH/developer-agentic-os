# src/server/operational/operational-executor.ts

- createOperationalExecutor · function · L5-L183 — function createOperationalExecutor(root = process.cwd(), workspaceRoot = root)
- recoverInterruptedRuns · function · L7-L16 — async function recoverInterruptedRuns(repositoryId?: string): Promise<number>
- runPolicy · function · L18-L134 — async function runPolicy( policyId: string, repositoryId: string, trigger: "schedule" | "provider" = "schedule", input: Record<string, unknown> = {} )
- runDueSchedule · method · L138-L181 — async runDueSchedule(repositoryId: string): Promise<number>
