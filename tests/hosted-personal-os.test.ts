import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.HOSTED_AUTH_FIXTURE_MODE = "true";
process.env.HOSTED_JSON_FIXTURE_MODE = "true";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import {
  HostedDomainStore,
  hostedDomainStoreForTenant,
} from "../src/server/hosted-domain/hosted-domain-store";
import {
  AuthError,
  DeterministicAuthAdapter,
  TokenAuthAdapter,
  UnconfiguredHostedTokenVerifier,
} from "../src/server/hosted-auth/auth-adapter";
import { DeterministicJsonHostedStateProvider } from "../src/server/hosted-domain/hosted-domain-store";
import { LocalHostedObjectStore } from "../src/server/hosted-domain/hosted-object-store";
import {
  GET as getHostedDomain,
  POST as postHostedDomain,
} from "../src/app/api/hosted/domain/route";
import { POST as createHostedWorkspace } from "../src/app/api/hosted/workspaces/route";
import { GET as getHostedAudit } from "../src/app/api/hosted/audit/route";
import { getLocalStorePaths } from "../src/server/local-store/paths";
import { writeJsonFile } from "../src/server/local-store/json-file";

async function withStore<T>(callback: (store: HostedDomainStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "developer-agentic-os-hosted-domain-"));
  try {
    return await callback(new HostedDomainStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("deterministic auth rejects spoofable headers outside explicit fixture mode", async () => {
  await assert.rejects(
    () =>
      new DeterministicAuthAdapter(false).authenticate(
        new Request("http://localhost", { headers: { "x-hosted-user-id": "spoofed" } })
      ),
    (error: unknown) => error instanceof AuthError
  );
});

test("fixture auth and JSON hosted state reject production use, and token setup is explicit", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  const previousAuthFixtureMode = environment.HOSTED_AUTH_FIXTURE_MODE;
  const previousJsonFixtureMode = environment.HOSTED_JSON_FIXTURE_MODE;
  environment.NODE_ENV = "production";
  environment.HOSTED_AUTH_FIXTURE_MODE = "true";
  environment.HOSTED_JSON_FIXTURE_MODE = "true";
  try {
    await assert.rejects(
      () =>
        new DeterministicAuthAdapter().authenticate(
          new Request("http://localhost", { headers: { "x-hosted-user-id": "spoofed" } })
        ),
      /configured hosted token/
    );
    const productionRoot = await mkdtemp(join(tmpdir(), "hosted-production-"));
    await assert.rejects(
      () => new DeterministicJsonHostedStateProvider(productionRoot).read(),
      /fixture-only/
    );
    await assert.rejects(
      () =>
        new TokenAuthAdapter(new UnconfiguredHostedTokenVerifier()).authenticate(
          new Request("http://localhost", { headers: { authorization: "Bearer token" } })
        ),
      /No hosted token verifier is configured/
    );
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
    if (previousAuthFixtureMode === undefined) delete environment.HOSTED_AUTH_FIXTURE_MODE;
    else environment.HOSTED_AUTH_FIXTURE_MODE = previousAuthFixtureMode;
    if (previousJsonFixtureMode === undefined) delete environment.HOSTED_JSON_FIXTURE_MODE;
    else environment.HOSTED_JSON_FIXTURE_MODE = previousJsonFixtureMode;
  }
});

test("hosted object references cannot escape the object root", async () => {
  const store = new LocalHostedObjectStore(await mkdtemp(join(tmpdir(), "hosted-objects-")));
  await assert.rejects(() => store.get("../hosted-domain.json"), /Invalid object reference/);
});

test("hosted domain records preserve relationships, isolate workspaces, and keep audit immutable", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const workItem = await store.putRecord("alice", workspaceId, "workItems", {
      title: "Review release",
      repositoryId: repository.id,
    });
    assert.equal((await store.listRecords("alice", workspaceId, "workItems"))[0].id, workItem.id);
    await assert.rejects(
      () => store.listRecords("bob", workspaceId, "workItems"),
      /Workspace not found/
    );
    const audit = await store.audit("alice", workspaceId);
    await assert.rejects(() => store.mutateAudit(audit[0].id), /immutable/);
  });
});

test("connectors require explicit repository and capability grants, and revocation is immediate", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await assert.rejects(
      () => store.connectorRequest("alice", connector.id, workspaceId, repository.id, "git.read"),
      /not granted/
    );
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await assert.rejects(
      () => store.setConnectorOffline("bob", workspaceId, connector.id),
      /Workspace not found/
    );
    const response = await store.connectorRequest(
      "alice",
      connector.id,
      workspaceId,
      repository.id,
      "git.read"
    );
    assert.equal(response.allowed, true);
    await store.revokeConnector("alice", workspaceId, connector.id);
    await assert.rejects(
      () => store.connectorRequest("alice", connector.id, workspaceId, repository.id, "git.read"),
      /revoked/
    );
  });
});

test("publication records freshness and offline local work stays pending", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    const snapshot = await store.publishSnapshot(
      "alice",
      connector.id,
      workspaceId,
      repository.id,
      { branch: "main", commit: "abc" }
    );
    assert.equal(snapshot.source, "local-connector");
    assert.equal(snapshot.freshness, "fresh");
    assert.equal(
      (await store.queueLocalWork("alice", workspaceId, repository.id, "run read-only skill"))
        .status,
      "pending_offline"
    );
    assert.equal(
      (await store.hostedSafeWork("alice", workspaceId, "check provider status")).status,
      "completed"
    );
    await store.setConnectorOffline("alice", workspaceId, connector.id);
    await assert.rejects(
      () => store.authorizeProviderMutation("alice", workspaceId, repository.id, "github-rerun"),
      /fresh connector evidence/
    );
  });
});

test("credential metadata and backup never expose secret material", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const credential = await store.saveCredential("alice", workspaceId, {
      provider: "github",
      scopes: ["repo:read"],
      secret: "super-secret",
    });
    assert.equal("secret" in credential, false);
    assert.equal("secret" in (await store.listCredentials("alice", workspaceId))[0], false);
    const backup = await store.exportBackup("alice", workspaceId);
    assert.equal(JSON.stringify(backup).includes("super-secret"), false);
    assert.equal(backup.version, 1);
    await store.revokeCredential("alice", workspaceId, credential.id);
    assert.equal((await store.listCredentials("alice", workspaceId))[0].status, "revoked");
  });
});

test("migration import is selective and idempotent, while filesystem access stays explicitly granted", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const packageData = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      repositories: [],
      records: {
        workItems: [{ externalId: "legacy-1", title: "Legacy" }],
        incomingSignals: [{ externalId: "signal-1", title: "Signal" }],
      },
      relationships: [],
      warnings: ["Some records have missing repository provenance."],
    };
    assert.deepEqual(
      await store.importMigration("alice", workspaceId, packageData, ["workItems"]),
      { imported: 1, warnings: packageData.warnings }
    );
    assert.equal(
      (await store.importMigration("alice", workspaceId, packageData, ["workItems"])).imported,
      0
    );
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await assert.rejects(
      () =>
        store.connectorRequest(
          "alice",
          connector.id,
          workspaceId,
          repository.id,
          "filesystem.read",
          "skill.read",
          "D:/repos/app/src"
        ),
      /not granted/
    );
  });
});

test("hosted domain route exposes reviewable migration and backup views without secrets", async () => {
  const headers = { "x-hosted-user-id": "route-hosted" };
  const workspace = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Route workspace" }),
    })
  );
  const workspaceId = ((await workspace.json()).workspace as { id: string }).id;
  const migration = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        localPath: "D:/repos/route",
      }),
    })
  );
  assert.equal(migration.status, 201);
  const response = await getHostedDomain(
    new Request(`http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=migration`, {
      headers,
    })
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).package.version, 1);
});

test("hosted work-item capture persists through the hosted domain route", async () => {
  const headers = { "x-hosted-user-id": `route-work-item-${Date.now()}` };
  const workspaceResponse = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Work queue" }),
    })
  );
  const workspaceId = ((await workspaceResponse.json()).workspace as { id: string }).id;

  const captureResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "create-work-item",
        workspaceId,
        title: "Ship hosted command centre",
        priority: "high",
      }),
    })
  );
  assert.equal(captureResponse.status, 201);

  const recordsResponse = await getHostedDomain(
    new Request(`http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=records`, {
      headers,
    })
  );
  const records = (await recordsResponse.json()).records as {
    workItems: Array<{ title: string; status: string; priority: string }>;
  };
  assert.deepEqual(
    records.workItems.map(({ title, status, priority }) => ({ title, status, priority })),
    [{ title: "Ship hosted command centre", status: "open", priority: "high" }]
  );
});

test("filesystem grants require Skill identity and allowlisted paths, with individual revocation", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await assert.rejects(
      () =>
        store.grantCapability("alice", workspaceId, connector.id, repository.id, "filesystem.read"),
      /Skill identity/
    );
    await store.grantCapability(
      "alice",
      workspaceId,
      connector.id,
      repository.id,
      "filesystem.read",
      "skill.read",
      ["D:/repos/app/src"]
    );
    await assert.rejects(
      () =>
        store.connectorRequest(
          "alice",
          connector.id,
          workspaceId,
          repository.id,
          "filesystem.read",
          "skill.other",
          "D:/repos/app/src/file.ts"
        ),
      /not granted/
    );
    assert.deepEqual(
      await store.connectorRequest(
        "alice",
        connector.id,
        workspaceId,
        repository.id,
        "filesystem.read",
        "skill.read",
        "D:/repos/app/src/file.ts"
      ),
      { allowed: true }
    );
    const grants = (await store.exportBackup("alice", workspaceId)).connectors[0].capabilities[
      repository.id
    ];
    assert.equal(grants.length, 2);
    await store.revokeCapability("alice", workspaceId, connector.id, repository.id, grants[1].id);
    await assert.rejects(
      () =>
        store.connectorRequest(
          "alice",
          connector.id,
          workspaceId,
          repository.id,
          "filesystem.read",
          "skill.read",
          "D:/repos/app/src/file.ts"
        ),
      /not granted/
    );
  });
});

test("migration remaps repository and record relationships and preserves artifact object references in backup", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const packageData = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      repositories: [{ id: "legacy-repo", localPath: "D:/repos/app", pathIdentity: "path-app" }],
      records: {
        artifacts: [
          {
            id: "legacy-artifact",
            externalId: "artifact-1",
            repositoryId: "legacy-repo",
            objectReference: "a".repeat(64),
          },
        ],
      },
      relationships: [{ from: "legacy-repo", to: "legacy-artifact", kind: "contains" }],
      warnings: [],
    };
    assert.equal((await store.importMigration("alice", workspaceId, packageData)).imported, 1);
    const backup = await store.exportBackup("alice", workspaceId);
    assert.equal(backup.relationships.length, 1);
    assert.equal(backup.relationships[0].from, backup.repositories[0].id);
    assert.equal(backup.relationships[0].to, backup.records.artifacts[0].id);
    assert.equal(backup.records.artifacts[0].objectReference, "a".repeat(64));
    assert.equal((await store.importMigration("alice", workspaceId, packageData)).imported, 0);
    assert.equal((await store.exportBackup("alice", workspaceId)).relationships.length, 1);
  });
});

test("provider mutation authorization requires approval and audits the decision", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await store.publishSnapshot("alice", connector.id, workspaceId, repository.id, {
      commit: "approved-base",
    });
    await assert.rejects(
      () =>
        store.authorizeProviderMutation("alice", workspaceId, repository.id, "github-rerun", {
          approved: true,
          reason: "Spoofed body approval",
        }),
      /persisted approval bound/
    );
    const snapshot = (await store.exportBackup("alice", workspaceId)).snapshots[0];
    const approvalRun = await store.putRecord("alice", workspaceId, "automationRuns", {
      repositoryId: repository.id,
      status: "approved",
      approval: { action: "github-rerun", evidenceSnapshotId: snapshot.id },
    });
    await store.authorizeProviderMutation("alice", workspaceId, repository.id, "github-rerun", {
      runId: approvalRun.id,
      approved: true,
    });
    const audit = await store.audit("alice", workspaceId);
    assert.equal(
      audit.filter((event) => event.action === "provider.mutation.authorization").at(-2)?.outcome,
      "denied"
    );
    assert.equal(audit.at(-1)?.outcome, "allowed");
  });
});

test("migration selects repositories, filters relationships, and rejects unmapped provenance", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const packageData = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      repositories: [
        { id: "keep", localPath: "D:/repos/keep", pathIdentity: "keep" },
        { id: "skip", localPath: "D:/repos/skip", pathIdentity: "skip" },
      ],
      records: {
        workItems: [
          { id: "kept", repositoryId: "keep", title: "Keep" },
          { id: "skipped", repositoryId: "skip", title: "Skip" },
        ],
      },
      relationships: [
        { from: "keep", to: "kept", kind: "contains" },
        { from: "skip", to: "skipped", kind: "contains" },
      ],
      warnings: [],
    };
    assert.equal(
      (await store.importMigration("alice", workspaceId, packageData, undefined, ["keep"]))
        .imported,
      1
    );
    const backup = await store.exportBackup("alice", workspaceId);
    assert.equal(backup.repositories.length, 1);
    assert.equal(backup.records.workItems.length, 1);
    assert.equal(backup.relationships.length, 1);
    const unmapped = {
      ...packageData,
      records: { workItems: [{ id: "foreign", repositoryId: "missing", title: "Foreign" }] },
    };
    await assert.rejects(
      () => store.importMigration("alice", workspaceId, unmapped),
      /unmapped repository provenance/
    );
  });
});

test("filesystem grants canonicalize paths and block traversal outside the repository root", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await assert.rejects(
      () =>
        store.grantCapability(
          "alice",
          workspaceId,
          connector.id,
          repository.id,
          "filesystem.read",
          "skill.read",
          ["D:/repos/app/../secrets"]
        ),
      /outside the repository root/
    );
    await store.grantCapability(
      "alice",
      workspaceId,
      connector.id,
      repository.id,
      "filesystem.read",
      "skill.read",
      ["D:/repos/app/src/../src"]
    );
    await assert.rejects(
      () =>
        store.connectorRequest(
          "alice",
          connector.id,
          workspaceId,
          repository.id,
          "filesystem.read",
          "skill.read",
          "D:/repos/app/src/../../secrets"
        ),
      /not granted/
    );
  });
});

test("hosted artifact records store object metadata instead of inline content", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const record = await store.putRecord("alice", workspaceId, "artifacts", {
      name: "large",
      content: { payload: "x".repeat(1000) },
    });
    assert.equal("content" in record, false);
    assert.equal(typeof record.objectReference, "string");
    assert.equal(record.objectContentType, "application/json");
    assert.equal(
      (await store.exportBackup("alice", workspaceId)).records.artifacts[0].content,
      undefined
    );
  });
});

test("hosted views and read-only skill action expose scoped evidence", async () => {
  const headers = { "x-hosted-user-id": `route-skill-${Date.now()}` };
  const workspace = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Skill workspace" }),
    })
  );
  const workspaceId = ((await workspace.json()).workspace as { id: string }).id;
  const repositoryResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        localPath: "D:/repos/skill",
      }),
    })
  );
  const repository = (await repositoryResponse.json()).repository as { id: string };
  const connectorResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "register-connector", workspaceId }),
    })
  );
  const connector = (await connectorResponse.json()).connector as { id: string };
  await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "grant-repository",
        workspaceId,
        connectorId: connector.id,
        repositoryId: repository.id,
      }),
    })
  );
  const skill = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "run-read-only-skill",
        workspaceId,
        connectorId: connector.id,
        repositoryId: repository.id,
        skillId: "repo-summary",
      }),
    })
  );
  assert.equal(skill.status, 200);
  assert.equal((await skill.json()).run.skillId, "repo-summary");
  const view = await getHostedDomain(
    new Request(
      `http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=capability-grants`,
      { headers }
    )
  );
  assert.equal(view.status, 200);
  assert.ok(Array.isArray((await view.json()).grants));
});

test("migration export includes local-store records and preserves repository provenance", async () => {
  await withStore(async (store) => {
    const root = (store as unknown as { root: string }).root;
    const paths = getLocalStorePaths(root);
    await writeJsonFile(paths.workspace, {
      repositories: [{ id: "local-repo", name: "app", path: "D:/repos/app" }],
      activeRepositoryId: "local-repo",
    });
    await writeJsonFile(paths.workItems, [
      { id: "local-work", title: "Local item", repositoryId: "local-repo" },
    ]);
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const migration = await store.exportMigration("alice", workspaceId);
    assert.equal(migration.records.workItems?.[0].repositoryId, "local-repo");
    assert.equal(
      migration.repositories.find((repository) => repository.id === "local-repo")?.pathIdentity,
      "local-repo"
    );
    const importedWorkspace = (await store.createWorkspace("alice", "Imported")).id;
    assert.equal(
      (
        await store.importMigration("alice", importedWorkspace, migration, undefined, [
          "local-repo",
        ])
      ).imported,
      1
    );
    const importedRepository = (await store.exportBackup("alice", importedWorkspace))
      .repositories[0];
    assert.equal(
      (await store.listRecords("alice", importedWorkspace, "workItems"))[0].repositoryId,
      importedRepository.id
    );
  });
});

test("connector expiry immediately stales snapshots and is normalized by evidence reads", async () => {
  await withStore(async (store) => {
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    const repository = await store.registerRepository("alice", workspaceId, "D:/repos/app");
    const connector = await store.registerConnector("alice", workspaceId, 60_000);
    await store.grantRepository("alice", workspaceId, connector.id, repository.id);
    await store.publishSnapshot("alice", connector.id, workspaceId, repository.id, {
      commit: "before-expiry",
    });
    const statePath = join(
      (store as unknown as { root: string }).root,
      ".developer-agentic-os",
      "hosted-domain.json"
    );
    const fs = await import("node:fs/promises");
    const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      connectors: Array<{ id: string; expiresAt: string }>;
    };
    state.connectors.find((item) => item.id === connector.id)!.expiresAt = new Date(
      Date.now() - 1
    ).toISOString();
    await fs.writeFile(statePath, JSON.stringify(state));
    assert.equal((await store.listSnapshots("alice", workspaceId))[0]?.freshness, "stale");
    assert.equal(
      (await store.listConnectorStatus("alice", workspaceId)).find(
        (item) => item.id === connector.id
      )?.state,
      "offline"
    );
    assert.equal(
      (await store.exportBackup("alice", workspaceId)).connectors.find(
        (item) => item.id === connector.id
      )?.state,
      "offline"
    );
  });
});

test("backup includes restoration identity and credential route forwards metadata", async () => {
  const headers = { "x-hosted-user-id": `route-credentials-${Date.now()}` };
  const workspaceResponse = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Metadata workspace" }),
    })
  );
  const workspace = (await workspaceResponse.json()).workspace as {
    id: string;
    ownerId: string;
    name: string;
  };
  const credentialResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "save-credential",
        workspaceId: workspace.id,
        provider: "github",
        scopes: ["repo:read"],
        secret: "fixture-secret",
        expiresAt: "2030-01-01T00:00:00.000Z",
        identity: "alice@example.test",
      }),
    })
  );
  assert.equal(credentialResponse.status, 201);
  const credential = (await credentialResponse.json()).credential as {
    id: string;
    expiresAt: string;
    identity: string;
    scopes: string[];
  };
  assert.equal(credential.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.equal(credential.identity, "alice@example.test");
  assert.deepEqual(credential.scopes, ["repo:read"]);
  const backupResponse = await getHostedDomain(
    new Request(`http://localhost/api/hosted/domain?workspaceId=${workspace.id}&view=backup`, {
      headers,
    })
  );
  const backup = (await backupResponse.json()).backup as {
    workspace: typeof workspace;
    restorationIdentity: { workspaceId: string; ownerId: string };
  };
  assert.deepEqual(backup.workspace, workspace);
  assert.deepEqual(backup.restorationIdentity, {
    workspaceId: workspace.id,
    ownerId: workspace.ownerId,
  });
  const revoked = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "revoke-credential",
        workspaceId: workspace.id,
        credentialId: credential.id,
      }),
    })
  );
  assert.equal(revoked.status, 200);
  assert.equal(
    (
      await getHostedDomain(
        new Request(
          `http://localhost/api/hosted/domain?workspaceId=${workspace.id}&view=credentials`,
          { headers }
        )
      )
    ).status,
    200
  );
});

test("hosted domain rejects malformed nested payloads with 400 and audit aggregates domain events", async () => {
  const headers = { "x-hosted-user-id": `route-validation-${Date.now()}` };
  const workspaceResponse = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Validation workspace" }),
    })
  );
  const workspaceId = ((await workspaceResponse.json()).workspace as { id: string }).id;
  const invalid = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "grant-capability",
        workspaceId,
        connectorId: "c",
        repositoryId: "r",
        capability: "filesystem.read",
        skillId: "skill",
        allowedPaths: ["D:/repo/src", 7],
      }),
    })
  );
  assert.equal(invalid.status, 400);
  const audit = await getHostedAudit(new Request("http://localhost/api/hosted/audit", { headers }));
  assert.equal(audit.status, 200);
  assert.ok(
    (await audit.json()).events.some(
      (event: { action: string }) => event.action === "workspace.created"
    )
  );
});

test("hosted routes reject null and malformed JSON bodies with 400", async () => {
  const headers = { "x-hosted-user-id": `route-null-${Date.now()}` };
  const nullBody = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", { method: "POST", headers, body: "null" })
  );
  assert.equal(nullBody.status, 400);
  const malformed = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", { method: "POST", headers, body: "{" })
  );
  assert.equal(malformed.status, 400);
  const domainNull = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", { method: "POST", headers, body: "null" })
  );
  assert.equal(domainNull.status, 400);
});

test("credential persistence delegates the secret to an injected protected store", async () => {
  const references: string[] = [];
  const secretStore = {
    put: async (secret: string) => {
      references.push(secret);
      return "protected://fixture-reference";
    },
  };
  await withStore(async (baseStore) => {
    const root = (baseStore as unknown as { root: string }).root;
    const store = new HostedDomainStore(
      root,
      undefined,
      undefined,
      undefined,
      undefined,
      secretStore
    );
    const workspaceId = (await store.createWorkspace("alice", "Workspace")).id;
    await store.saveCredential("alice", workspaceId, {
      provider: "github",
      scopes: ["repo:read"],
      secret: "opaque-secret",
    });
    assert.deepEqual(references, ["opaque-secret"]);
    assert.equal(
      JSON.stringify(await store.exportBackup("alice", workspaceId)).includes("opaque-secret"),
      false
    );
  });
});

test("hosted domain exposes scoped records, repositories, snapshots, connectors, and audit views", async () => {
  const headers = { "x-hosted-user-id": `route-views-${Date.now()}` };
  const workspaceResponse = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Views workspace" }),
    })
  );
  const workspaceId = ((await workspaceResponse.json()).workspace as { id: string }).id;
  for (const view of [
    "repositories",
    "records",
    "snapshots",
    "connectors",
    "credentials",
    "audit",
  ]) {
    const response = await getHostedDomain(
      new Request(`http://localhost/api/hosted/domain?workspaceId=${workspaceId}&view=${view}`, {
        headers,
      })
    );
    assert.equal(response.status, 200, view);
  }
});

test("hosted API offline, reconnect, and resume actions preserve pending work", async () => {
  const headers = { "x-hosted-user-id": `route-offline-${Date.now()}` };
  const workspaceResponse = await createHostedWorkspace(
    new Request("http://localhost/api/hosted/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Offline workspace" }),
    })
  );
  const workspaceId = ((await workspaceResponse.json()).workspace as { id: string }).id;
  const repositoryResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "register-repository",
        workspaceId,
        localPath: "D:/repos/offline",
      }),
    })
  );
  const repositoryId = ((await repositoryResponse.json()).repository as { id: string }).id;
  const connectorResponse = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "register-connector", workspaceId }),
    })
  );
  const connectorId = ((await connectorResponse.json()).connector as { id: string }).id;
  assert.equal(
    (
      await postHostedDomain(
        new Request("http://localhost/api/hosted/domain", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "grant-repository",
            workspaceId,
            connectorId,
            repositoryId,
          }),
        })
      )
    ).status,
    200
  );
  const store = hostedDomainStoreForTenant(`personal:${headers["x-hosted-user-id"]}`);
  await store.setConnectorOffline(headers["x-hosted-user-id"], workspaceId, connectorId);
  const queued = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "queue-local-work",
        workspaceId,
        repositoryId,
        description: "offline work",
      }),
    })
  );
  assert.equal(queued.status, 202);
  assert.equal(
    (
      await postHostedDomain(
        new Request("http://localhost/api/hosted/domain", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "reconnect-connector", workspaceId, connectorId }),
        })
      )
    ).status,
    200
  );
  const resumed = await postHostedDomain(
    new Request("http://localhost/api/hosted/domain", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "resume-local-work", workspaceId, connectorId }),
    })
  );
  assert.equal((await resumed.json()).resumed, 1);
});
