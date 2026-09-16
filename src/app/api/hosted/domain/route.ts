import { NextResponse } from "next/server";

import { hostedError, hostedIdentity } from "@/app/api/hosted/_shared";
import type { HostedRecordKind } from "@/server/hosted-domain/hosted-domain-store";

const capabilities = ["git.read", "filesystem.read", "filesystem.write"] as const;
const recordKinds = [
  "repositories",
  "workItems",
  "incomingSignals",
  "incidents",
  "automationRuns",
  "approvals",
  "artifacts",
  "skillRuns",
] as const;
const views = [
  "backup",
  "migration",
  "credentials",
  "connector-status",
  "repository-grants",
  "capability-grants",
  "repositories",
  "records",
  "snapshots",
  "connectors",
  "audit",
] as const;

type HostedDomainBody = {
  action?: unknown;
  workspaceId?: unknown;
  connectorId?: unknown;
  credentialId?: unknown;
  repositoryId?: unknown;
  capability?: unknown;
  skillId?: unknown;
  allowedPaths?: unknown;
  localPath?: unknown;
  data?: unknown;
  package?: unknown;
  selectedKinds?: unknown;
  selectedRepositoryIds?: unknown;
  description?: unknown;
  title?: unknown;
  notes?: unknown;
  priority?: unknown;
  dueAt?: unknown;
  provider?: unknown;
  scopes?: unknown;
  secret?: unknown;
  expiresAt?: unknown;
  identity?: unknown;
  grantId?: unknown;
  requestedPath?: unknown;
  approval?: unknown;
  providerAction?: unknown;
};

export async function GET(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const hostedDomainStore = identity.domainStore;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId)
    return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  const view = url.searchParams.get("view");
  if (view && !views.includes(view as (typeof views)[number]))
    return NextResponse.json({ error: "Unknown hosted domain view." }, { status: 400 });
  try {
    if (url.searchParams.get("view") === "backup")
      return NextResponse.json({
        backup: await hostedDomainStore.exportBackup(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "migration")
      return NextResponse.json({
        package: await hostedDomainStore.exportMigration(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "credentials")
      return NextResponse.json({
        credentials: await hostedDomainStore.listCredentials(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "connector-status")
      return NextResponse.json({
        connectors: await hostedDomainStore.listConnectorStatus(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "repository-grants")
      return NextResponse.json({
        grants: await hostedDomainStore.listRepositoryGrants(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "capability-grants")
      return NextResponse.json({
        grants: await hostedDomainStore.listCapabilityGrants(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "repositories")
      return NextResponse.json({
        repositories: await hostedDomainStore.listRepositories(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "records")
      return NextResponse.json({
        records: await hostedDomainStore.listAllRecords(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "snapshots")
      return NextResponse.json({
        snapshots: await hostedDomainStore.listSnapshots(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "connectors")
      return NextResponse.json({
        connectors: await hostedDomainStore.listConnectorStatus(identity.userId, workspaceId),
      });
    if (url.searchParams.get("view") === "audit" || !url.searchParams.get("view"))
      return NextResponse.json({
        audit: await hostedDomainStore.audit(identity.userId, workspaceId),
      });
    return NextResponse.json({
      audit: await hostedDomainStore.audit(identity.userId, workspaceId),
    });
  } catch (error) {
    return hostedError(error);
  }
}

export async function POST(request: Request) {
  const identity = await hostedIdentity(request);
  if (identity instanceof NextResponse) return identity;
  const hostedDomainStore = identity.domainStore;
  try {
    let body: HostedDomainBody;
    try {
      body = (await request.json()) as HostedDomainBody;
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (
      !isRecord(body) ||
      typeof body.workspaceId !== "string" ||
      !body.workspaceId.trim() ||
      typeof body.action !== "string" ||
      !body.action.trim()
    )
      return NextResponse.json({ error: "workspaceId and action are required." }, { status: 400 });
    const validationError = validateBody(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    switch (body.action) {
      case "register-repository":
        return NextResponse.json(
          {
            repository: await hostedDomainStore.registerRepository(
              identity.userId,
              body.workspaceId as string,
              body.localPath as string
            ),
          },
          { status: 201 }
        );
      case "register-connector":
        return NextResponse.json(
          {
            connector: await hostedDomainStore.registerConnector(
              identity.userId,
              body.workspaceId as string,
              60 * 60 * 1000
            ),
          },
          { status: 201 }
        );
      case "grant-repository":
        await hostedDomainStore.grantRepository(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string,
          body.repositoryId as string
        );
        return NextResponse.json({ ok: true });
      case "revoke-repository":
        await hostedDomainStore.revokeRepository(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string,
          body.repositoryId as string
        );
        return NextResponse.json({ ok: true });
      case "grant-capability":
        await hostedDomainStore.grantCapability(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string,
          body.repositoryId as string,
          body.capability as "git.read" | "filesystem.read" | "filesystem.write",
          body.skillId as string | undefined,
          body.allowedPaths as string[] | undefined
        );
        return NextResponse.json({ ok: true });
      case "revoke-capability":
        await hostedDomainStore.revokeCapability(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string,
          body.repositoryId as string,
          body.grantId as string
        );
        return NextResponse.json({ ok: true });
      case "revoke-connector":
        await hostedDomainStore.revokeConnector(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string
        );
        return NextResponse.json({ ok: true });
      case "set-connector-offline":
        await hostedDomainStore.setConnectorOffline(
          identity.userId,
          body.workspaceId as string,
          body.connectorId as string
        );
        return NextResponse.json({ ok: true });
      case "reconnect-connector":
        return NextResponse.json({
          connector: await hostedDomainStore.reconnectConnector(
            identity.userId,
            body.workspaceId as string,
            body.connectorId as string,
            60 * 60 * 1000
          ),
        });
      case "resume-local-work":
        return NextResponse.json({
          resumed: await hostedDomainStore.resumePendingLocalWork(
            identity.userId,
            body.workspaceId as string,
            body.connectorId as string
          ),
        });
      case "connector-request":
        return NextResponse.json(
          await hostedDomainStore.connectorRequest(
            identity.userId,
            body.connectorId as string,
            body.workspaceId as string,
            body.repositoryId as string,
            body.capability as "git.read" | "filesystem.read" | "filesystem.write",
            body.skillId as string | undefined,
            body.requestedPath as string | undefined
          )
        );
      case "publish-snapshot":
        return NextResponse.json({
          snapshot: await hostedDomainStore.publishSnapshot(
            identity.userId,
            body.connectorId as string,
            body.workspaceId as string,
            body.repositoryId as string,
            body.data as Record<string, unknown>
          ),
        });
      case "authorize-provider-mutation":
        await hostedDomainStore.authorizeProviderMutation(
          identity.userId,
          body.workspaceId as string,
          body.repositoryId as string,
          body.providerAction as string,
          body.approval as {
            approved?: boolean;
            runId?: string;
            reason?: string;
            action?: string;
            evidenceSnapshotId?: string;
          }
        );
        return NextResponse.json({ authorized: true });
      case "run-read-only-skill":
        return NextResponse.json({
          run: await hostedDomainStore.runReadOnlySkill(
            identity.userId,
            body.workspaceId as string,
            body.connectorId as string,
            body.repositoryId as string,
            body.skillId as string
          ),
        });
      case "queue-local-work":
        return NextResponse.json(
          {
            work: await hostedDomainStore.queueLocalWork(
              identity.userId,
              body.workspaceId as string,
              body.repositoryId as string,
              body.description as string
            ),
          },
          { status: 202 }
        );
      case "hosted-safe-work":
        return NextResponse.json({
          work: await hostedDomainStore.hostedSafeWork(
            identity.userId,
            body.workspaceId as string,
            body.description as string
          ),
        });
      case "create-work-item": {
        const now = new Date().toISOString();
        const workItem = await hostedDomainStore.putRecord(
          identity.userId,
          body.workspaceId as string,
          "workItems",
          {
            title: (body.title as string).trim(),
            notes: typeof body.notes === "string" ? body.notes.trim() : "",
            status: "open",
            priority: body.priority ?? "normal",
            dueAt: body.dueAt ?? null,
            createdAt: now,
            updatedAt: now,
          }
        );
        return NextResponse.json({ workItem }, { status: 201 });
      }
      case "save-credential":
        return NextResponse.json(
          {
            credential: await hostedDomainStore.saveCredential(
              identity.userId,
              body.workspaceId as string,
              {
                provider: body.provider as string,
                scopes: body.scopes as string[],
                secret: body.secret as string,
                expiresAt: body.expiresAt as string | null | undefined,
                identity: body.identity as string | null | undefined,
              }
            ),
          },
          { status: 201 }
        );
      case "revoke-credential":
        await hostedDomainStore.revokeCredential(
          identity.userId,
          body.workspaceId as string,
          body.credentialId as string
        );
        return NextResponse.json({ ok: true });
      case "import-migration":
        return NextResponse.json({
          result: await hostedDomainStore.importMigration(
            identity.userId,
            body.workspaceId as string,
            body.package as Parameters<typeof hostedDomainStore.importMigration>[2],
            body.selectedKinds as HostedRecordKind[] | undefined,
            body.selectedRepositoryIds as string[] | undefined
          ),
        });
      default:
        return NextResponse.json({ error: "Unknown hosted domain action." }, { status: 400 });
    }
  } catch (error) {
    return hostedError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isStringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}
function requiredString(body: HostedDomainBody, key: keyof HostedDomainBody): boolean {
  return typeof body[key] === "string" && Boolean((body[key] as string).trim());
}
function validateBody(body: HostedDomainBody): string | null {
  const action = body.action as string;
  if (
    !(
      [
        "register-repository",
        "register-connector",
        "grant-repository",
        "revoke-repository",
        "grant-capability",
        "revoke-capability",
        "revoke-connector",
        "set-connector-offline",
        "reconnect-connector",
        "resume-local-work",
        "connector-request",
        "publish-snapshot",
        "authorize-provider-mutation",
        "run-read-only-skill",
        "queue-local-work",
        "hosted-safe-work",
        "create-work-item",
        "save-credential",
        "revoke-credential",
        "import-migration",
      ] as const
    ).includes(action as never)
  )
    return "Unknown hosted domain action.";
  const required = [
    "grant-repository",
    "revoke-repository",
    "grant-capability",
    "revoke-capability",
    "revoke-connector",
    "set-connector-offline",
    "reconnect-connector",
    "resume-local-work",
    "connector-request",
    "publish-snapshot",
    "authorize-provider-mutation",
    "run-read-only-skill",
    "queue-local-work",
    "hosted-safe-work",
    "save-credential",
    "revoke-credential",
    "import-migration",
  ];
  if (action === "register-repository" && !requiredString(body, "localPath"))
    return "localPath is required.";
  if (
    required.includes(action) &&
    !requiredString(body, "connectorId") &&
    ![
      "save-credential",
      "revoke-credential",
      "import-migration",
      "hosted-safe-work",
      "queue-local-work",
    ].includes(action)
  )
    return "connectorId is required.";
  if (
    [
      "grant-repository",
      "revoke-repository",
      "grant-capability",
      "revoke-capability",
      "connector-request",
      "publish-snapshot",
      "authorize-provider-mutation",
      "run-read-only-skill",
      "queue-local-work",
    ].includes(action) &&
    !requiredString(body, "repositoryId")
  )
    return "repositoryId is required.";
  if (
    ["grant-capability", "connector-request"].includes(action) &&
    (typeof body.capability !== "string" ||
      !capabilities.includes(body.capability as (typeof capabilities)[number]))
  )
    return "capability is invalid.";
  if (
    action === "grant-capability" &&
    body.capability !== "git.read" &&
    (!requiredString(body, "skillId") || !isStringArray(body.allowedPaths))
  )
    return "Filesystem grants require skillId and allowedPaths.";
  if (action === "publish-snapshot" && !isRecord(body.data)) return "data must be an object.";
  if (
    ["queue-local-work", "hosted-safe-work"].includes(action) &&
    !requiredString(body, "description")
  )
    return "description is required.";
  if (action === "create-work-item" && !requiredString(body, "title")) return "title is required.";
  if (action === "create-work-item" && body.notes !== undefined && typeof body.notes !== "string")
    return "notes must be a string.";
  if (
    action === "create-work-item" &&
    body.priority !== undefined &&
    !["low", "normal", "high", "urgent"].includes(body.priority as string)
  )
    return "priority is invalid.";
  if (
    action === "create-work-item" &&
    body.dueAt !== undefined &&
    body.dueAt !== null &&
    (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt)))
  )
    return "dueAt must be a valid date or null.";
  if (
    ["run-read-only-skill", "grant-capability", "connector-request"].includes(action) &&
    !requiredString(body, "skillId") &&
    action === "run-read-only-skill"
  )
    return "skillId is required.";
  if (
    ["authorize-provider-mutation"].includes(action) &&
    body.approval !== undefined &&
    !isRecord(body.approval)
  )
    return "approval is invalid.";
  if (action === "authorize-provider-mutation" && !requiredString(body, "providerAction"))
    return "providerAction is required.";
  if (
    ["register-connector"].includes(action) &&
    (body.connectorId !== undefined || body.repositoryId !== undefined)
  )
    return "register-connector does not accept connectorId or repositoryId.";
  if (
    action === "connector-request" &&
    body.requestedPath !== undefined &&
    typeof body.requestedPath !== "string"
  )
    return "requestedPath must be a string.";
  if (
    action === "save-credential" &&
    (!requiredString(body, "provider") ||
      !isStringArray(body.scopes) ||
      typeof body.secret !== "string" ||
      !body.secret)
  )
    return "provider, scopes, and secret are required.";
  if (
    action === "save-credential" &&
    body.expiresAt !== undefined &&
    body.expiresAt !== null &&
    (typeof body.expiresAt !== "string" || Number.isNaN(Date.parse(body.expiresAt)))
  )
    return "expiresAt must be a valid date or null.";
  if (
    action === "save-credential" &&
    body.identity !== undefined &&
    body.identity !== null &&
    typeof body.identity !== "string"
  )
    return "identity must be a string or null.";
  if (
    ["revoke-credential", "revoke-capability"].includes(action) &&
    !requiredString(body, action === "revoke-credential" ? "credentialId" : "grantId")
  )
    return `${action === "revoke-credential" ? "credentialId" : "grantId"} is required.`;
  if (action === "import-migration" && !isMigrationPackage(body.package))
    return "package is invalid.";
  if (
    action === "import-migration" &&
    body.selectedKinds !== undefined &&
    (!isStringArray(body.selectedKinds, true) ||
      body.selectedKinds.some(
        (kind) => !recordKinds.includes(kind as (typeof recordKinds)[number])
      ))
  )
    return "selectedKinds is invalid.";
  if (
    action === "import-migration" &&
    body.selectedRepositoryIds !== undefined &&
    !isStringArray(body.selectedRepositoryIds, true)
  )
    return "selectedRepositoryIds is invalid.";
  if (
    body.approval !== undefined &&
    (!isRecord(body.approval) ||
      (body.approval.approved !== undefined && typeof body.approval.approved !== "boolean") ||
      (body.approval.runId !== undefined && typeof body.approval.runId !== "string") ||
      (body.approval.reason !== undefined && typeof body.approval.reason !== "string") ||
      (body.approval.action !== undefined && typeof body.approval.action !== "string") ||
      (body.approval.evidenceSnapshotId !== undefined &&
        typeof body.approval.evidenceSnapshotId !== "string"))
  )
    return "approval is invalid.";
  return null;
}
function isMigrationPackage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string" ||
    !Array.isArray(value.repositories) ||
    !isRecord(value.records) ||
    !Array.isArray(value.relationships) ||
    !isStringArray(value.warnings, true)
  )
    return false;
  return (
    value.repositories.every(
      (item) =>
        isRecord(item) &&
        (item.id === undefined || typeof item.id === "string") &&
        typeof item.localPath === "string" &&
        typeof item.pathIdentity === "string"
    ) &&
    Object.values(value.records).every(
      (records) => Array.isArray(records) && records.every(isRecord)
    ) &&
    value.relationships.every(
      (item) =>
        isRecord(item) &&
        typeof item.from === "string" &&
        typeof item.to === "string" &&
        typeof item.kind === "string"
    )
  );
}
