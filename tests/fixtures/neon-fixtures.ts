/**
 * Neon Test Fixtures
 *
 * Provides sample data for testing multi-tenant isolation and adapter functionality.
 * Use these fixtures in unit tests and integration tests.
 *
 * Usage:
 *   import { seedTestData } from "@/test/fixtures/neon-fixtures";
 *   const { tenantId, adapter } = await seedTestData();
 */

import { NeonAdapter } from "@/server/adapters/neon-adapter";
import { randomUUID } from "node:crypto";

type NeonFixtureClient = {
  query(query: string, values?: unknown[]): Promise<unknown>;
  release(): void;
};

async function fixtureClient(adapter: NeonAdapter): Promise<NeonFixtureClient> {
  return (adapter as unknown as { getClient(): Promise<NeonFixtureClient> }).getClient();
}

export interface TestFixture {
  tenantId: string;
  adapter: NeonAdapter;
  artifacts: Record<string, unknown>[];
  workItems: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  routines: Record<string, unknown>[];
  repos: Record<string, unknown>[];
}

/**
 * Seed test data into a new tenant for testing.
 * Creates isolated test data that won't interfere with production.
 */
export async function seedTestData(): Promise<TestFixture> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL required for test fixtures");
  }

  const tenantId = randomUUID();
  const adapter = new NeonAdapter({
    databaseUrl,
    tenantId,
  });

  // Create test tenant
  const client = await fixtureClient(adapter);
  try {
    await client.query("INSERT INTO organizations (id, name, clerk_org_id) VALUES ($1, $2, $3)", [
      tenantId,
      "Test Org",
      `test-${randomUUID()}`,
    ]);
  } finally {
    client.release();
  }

  // Seed artifacts
  const artifacts = await Promise.all([
    adapter.createArtifact({
      title: "Sprint Plan",
      content: "# Sprint 1\n\n- Task 1\n- Task 2",
      type: "plan",
      tags: ["sprint", "planning"],
    }),
    adapter.createArtifact({
      title: "Release Notes",
      content: "## v1.0.0\n\nInitial release",
      type: "release",
      tags: ["release"],
    }),
    adapter.createArtifact({
      title: "Architecture Decision",
      content: "## Decision: Use Neon for multi-tenancy",
      type: "decision",
      is_draft: true,
      tags: ["architecture"],
    }),
  ]);

  // Seed work items
  const workItems = await Promise.all([
    adapter.createWorkItem({
      title: "Implement auth integration",
      description: "Set up Clerk with GitHub OAuth",
      status: "open",
      priority: "high",
    }),
    adapter.createWorkItem({
      title: "Design dashboard layout",
      description: "Create wireframes for command centre",
      status: "in_progress",
      priority: "high",
    }),
    adapter.createWorkItem({
      title: "Write unit tests",
      description: "Add tests for adapter layer",
      status: "open",
      priority: "medium",
    }),
    adapter.createWorkItem({
      title: "Optimize queries",
      description: "Add missing indexes",
      status: "done",
      priority: "low",
    }),
  ]);

  // Seed skills
  const skills = await Promise.all([
    adapter.createSkill({
      command: "/repo-summary",
      display_name: "Repository Summary",
      description: "Generate a summary of the repository structure",
      effort_level: "quick",
      is_builtin: true,
      model: "claude-3.5-sonnet",
    }),
    adapter.createSkill({
      command: "/release-readiness",
      display_name: "Release Readiness Check",
      description: "Evaluate if the codebase is ready for release",
      effort_level: "deep",
      is_builtin: true,
      model: "claude-3.5-sonnet",
    }),
  ]);

  // Seed routines
  const routines = await Promise.all([
    adapter.createRoutine({
      name: "nightly_digest",
      description: "Generate nightly digest of repository activity",
      schedule: "0 2 * * *",
      is_active: true,
    }),
    adapter.createRoutine({
      name: "weekly_review",
      description: "Weekly sprint review",
      schedule: "0 10 * * 5",
      is_active: true,
    }),
  ]);

  // Seed repos
  const repos = await Promise.all([
    adapter.createRepo({
      github_owner: "acme-corp",
      github_repo: "main-app",
      github_url: "https://github.com/acme-corp/main-app",
      default_branch: "main",
    }),
    adapter.createRepo({
      github_owner: "acme-corp",
      github_repo: "backend-api",
      github_url: "https://github.com/acme-corp/backend-api",
      default_branch: "develop",
    }),
  ]);

  return {
    tenantId,
    adapter,
    artifacts,
    workItems,
    skills,
    routines,
    repos,
  };
}

/**
 * Clean up test data from a tenant.
 * Deletes all tables associated with a tenant.
 */
export async function cleanupTestData(adapter: NeonAdapter, tenantId: string): Promise<void> {
  const client = await (adapter as any).getClient();
  try {
    // Delete in reverse order of foreign key dependencies
    await client.query("DELETE FROM focus_board_items WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM emails WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM handoffs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM graph_links WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM graph_nodes WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM routine_runs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM routine_runs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM skill_runs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM incoming_signals WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM deployment_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM vercel_projects WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM github_pull_requests WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM github_issues WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM work_items WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM artifacts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM repos WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM routines WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM skills WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM org_members WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM organizations WHERE id = $1", [tenantId]);
  } finally {
    client.release();
  }
}

/**
 * Example test using fixtures.
 *
 * Usage in jest:
 *   import { seedTestData, cleanupTestData } from "@/test/fixtures/neon-fixtures";
 *
 *   describe("NeonAdapter", () => {
 *     let fixture: TestFixture;
 *
 *     beforeAll(async () => {
 *       fixture = await seedTestData();
 *     });
 *
 *     afterAll(async () => {
 *       await cleanupTestData(fixture.adapter, fixture.tenantId);
 *       await fixture.adapter.close();
 *     });
 *
 *     test("should list artifacts for tenant", async () => {
 *       const artifacts = await fixture.adapter.listArtifacts();
 *       expect(artifacts).toHaveLength(fixture.artifacts.length);
 *       expect(artifacts.every(a => a.tenant_id === fixture.tenantId)).toBe(true);
 *     });
 *   });
 */

/**
 * Verify tenant isolation.
 * Checks that data from one tenant does not leak to another.
 */
export async function verifyTenantIsolation(
  adapter1: NeonAdapter,
  tenantId1: string,
  adapter2: NeonAdapter,
  tenantId2: string
): Promise<boolean> {
  const artifacts1 = await adapter1.listArtifacts();
  const artifacts2 = await adapter2.listArtifacts();

  // Verify each adapter only sees its own tenant's data
  const isolation1 = artifacts1.every((a) => (a as { tenant_id?: string }).tenant_id === tenantId1);
  const isolation2 = artifacts2.every((a) => (a as { tenant_id?: string }).tenant_id === tenantId2);

  return isolation1 && isolation2;
}

/**
 * Dump test fixture data for debugging.
 * Prints all seeded data to console.
 */
export async function dumpFixtureData(fixture: TestFixture): Promise<void> {
  console.log("\n=== Test Fixture Data ===");
  console.log(`Tenant ID: ${fixture.tenantId}\n`);

  console.log("Artifacts:");
  fixture.artifacts.forEach((a) =>
    console.log(`  - ${String((a as { title?: unknown }).title ?? "")}`)
  );

  console.log("\nWork Items:");
  fixture.workItems.forEach((w) => {
    const item = w as { title?: unknown; status?: unknown };
    console.log(`  - ${String(item.title ?? "")} (${String(item.status ?? "")})`);
  });

  console.log("\nSkills:");
  fixture.skills.forEach((s) =>
    console.log(`  - ${String((s as { command?: unknown }).command ?? "")}`)
  );

  console.log("\nRoutines:");
  fixture.routines.forEach((r) =>
    console.log(`  - ${String((r as { name?: unknown }).name ?? "")}`)
  );

  console.log("\nRepos:");
  fixture.repos.forEach((r) =>
    console.log(`  - ${(r as any).github_owner}/${(r as any).github_repo}`)
  );

  console.log("======================\n");
}
