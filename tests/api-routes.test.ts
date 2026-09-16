import assert from "node:assert/strict";
import test from "node:test";

import { GET as getArtifacts, POST as postArtifact } from "../src/app/api/artifacts/route";
import { GET as getFocusBoard } from "../src/app/api/focus-board/route";
import { GET as getArtifact } from "../src/app/api/artifacts/[id]/route";
import { GET as getIntegrations } from "../src/app/api/integrations/route";
import { GET as getGitHubOperations } from "../src/app/api/integrations/github/route";
import { GET as getVercelOperations } from "../src/app/api/integrations/vercel/route";
import { GET as getRepoIndex } from "../src/app/api/repo/index/route";
import { POST as refreshRepo } from "../src/app/api/repo/refresh/route";
import { GET as getRoutineRuns } from "../src/app/api/routine-runs/route";
import { GET as getRoutines } from "../src/app/api/routines/route";
import { POST as pauseRoutine } from "../src/app/api/routines/[id]/pause/route";
import { POST as resumeRoutine } from "../src/app/api/routines/[id]/resume/route";
import { POST as runRoutine } from "../src/app/api/routines/[id]/run/route";
import { GET as getGraph } from "../src/app/api/second-brain/graph/route";
import { GET as getSkillRuns } from "../src/app/api/skill-runs/route";
import { GET as getSkills } from "../src/app/api/skills/route";
import { POST as runSkill } from "../src/app/api/skills/[id]/run/route";

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("collection routes return their typed top-level contracts", async () => {
  const artifacts = await getArtifacts(new Request("http://localhost/api/artifacts?limit=1"));
  const focusBoard = await getFocusBoard(new Request("http://localhost/api/focus-board?limit=1"));
  const repo = await getRepoIndex();
  const skills = await getSkills();
  const skillRuns = await getSkillRuns(new Request("http://localhost/api/skill-runs?limit=1"));
  const routines = await getRoutines();
  const routineRuns = await getRoutineRuns(
    new Request("http://localhost/api/routine-runs?limit=1")
  );
  const integrations = await getIntegrations();
  const graph = await getGraph();
  const graphBody = await body(graph);

  assert.ok(Array.isArray((await body(artifacts)).artifacts));
  assert.ok(Array.isArray((await body(focusBoard)).workItems));
  assert.ok(Array.isArray((await body(repo)).files));
  assert.ok(Array.isArray((await body(skills)).skills));
  assert.ok(Array.isArray((await body(skillRuns)).runs));
  assert.ok(Array.isArray((await body(routines)).routines));
  assert.ok(Array.isArray((await body(routineRuns)).executions));
  assert.ok(Array.isArray((await body(integrations)).integrations));
  assert.ok(Array.isArray(graphBody.nodes));
  assert.ok(Array.isArray(graphBody.links));
});

test("integration routes preserve repository context boundaries", async () => {
  const response = await getIntegrations(
    new Request("http://localhost/api/integrations?repositoryId=missing-context")
  );
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(await body(response)), /Repository context not found/);
});

test("artifact routes validate input and reject unknown artifacts", async () => {
  const invalid = await postArtifact(
    new Request("http://localhost/api/artifacts", { method: "POST", body: "{}" })
  );
  assert.equal(invalid.status, 400);

  const missing = await getArtifact(new Request("http://localhost/api/artifacts/missing"), {
    params: Promise.resolve({ id: "missing" }),
  });
  assert.equal(missing.status, 404);
});

test("run and routine mutation routes return not-found errors for unknown ids", async () => {
  const skill = await runSkill(
    new Request("http://localhost/api/skills/missing/run", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  const routine = await runRoutine(
    new Request("http://localhost/api/routines/missing/run", { method: "POST" }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  const pause = await pauseRoutine(
    new Request("http://localhost/api/routines/missing/pause", { method: "POST" }),
    { params: Promise.resolve({ id: "missing" }) }
  );
  const resume = await resumeRoutine(
    new Request("http://localhost/api/routines/missing/resume", { method: "POST" }),
    { params: Promise.resolve({ id: "missing" }) }
  );

  assert.equal(skill.status, 404);
  assert.equal(routine.status, 404);
  assert.equal(pause.status, 404);
  assert.equal(resume.status, 404);
});

test("repo refresh route returns a refreshable snapshot", async () => {
  const response = await refreshRepo();
  const snapshot = await body(response);
  assert.equal(response.status, 200);
  assert.equal(typeof snapshot.refreshedAt, "string");
  assert.ok(Array.isArray(snapshot.files));
  assert.ok(snapshot.git && typeof snapshot.git === "object");
});

test("invalid repository context is rejected before a skill run is created", async () => {
  const response = await runSkill(
    new Request("http://localhost/api/skills/repo-summary/run", {
      method: "POST",
      body: JSON.stringify({ repositoryId: "missing-context" }),
    }),
    { params: Promise.resolve({ id: "repo-summary" }) }
  );
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(await body(response)), /Repository context not found/);
});

test("repository routes reject unregistered roots", async () => {
  const response = await getRepoIndex(
    new Request("http://localhost/api/repo/index?repositoryRoot=C%3A%5Cdefinitely-unregistered")
  );
  assert.equal(response.status, 404);
});

test("github operations route rejects an unknown repository context", async () => {
  const response = await getGitHubOperations(
    new Request("http://localhost/api/integrations/github?repositoryId=missing-context")
  );
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(await body(response)), /Repository context not found/);
});

test("vercel operations route rejects an unknown repository context", async () => {
  const response = await getVercelOperations(
    new Request("http://localhost/api/integrations/vercel?repositoryId=missing-context")
  );
  assert.equal(response.status, 404);
  assert.match(JSON.stringify(await body(response)), /Repository context not found/);
});
