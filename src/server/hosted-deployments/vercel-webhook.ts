import { createHmac, timingSafeEqual } from "node:crypto";

export type VercelWebhookProject = {
  tenantId: string;
  projectId: string;
  teamId?: string;
  secret: string;
  previousSecret?: string;
};

export type VercelWebhookEvent = {
  tenantId: string;
  projectId: string;
  deploymentId: string;
  eventType: string;
  status: string | null;
  url: string | null;
  commitSha: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  deliveryId?: string;
};

export type VercelWebhookAuditEntry = {
  action:
    "unknown_project" | "invalid_signature" | "invalid_payload" | "duplicate" | "processing_failed";
  projectId?: string;
};

export interface VercelWebhookRepository {
  findProject(projectId: string, teamId?: string): Promise<VercelWebhookProject | null>;
  recordEvent(event: VercelWebhookEvent): Promise<{ duplicate: boolean; deliveryId?: string }>;
  updateProjection?(event: VercelWebhookEvent): Promise<void>;
  recordFailureSignal?(event: VercelWebhookEvent): Promise<void>;
  recordAudit(entry: VercelWebhookAuditEntry): Promise<void>;
}

export async function handleVercelWebhook(
  request: Request,
  repository: VercelWebhookRepository
): Promise<Response> {
  const rawBody = await request.text();
  const payload = parsePayload(rawBody);
  if (!payload) {
    await repository.recordAudit({ action: "invalid_payload" });
    return json({ error: "Invalid webhook payload." }, 400);
  }

  const envelope = objectValue(payload.payload) ?? payload;
  const nestedProject = objectValue(envelope.project);
  const deployment = objectValue(envelope.deployment);
  const team = objectValue(envelope.team);
  const projectId = stringValue(nestedProject?.id) ?? stringValue(payload.projectId);
  const teamId = stringValue(team?.id) ?? stringValue(payload.teamId);
  if (!projectId) {
    await repository.recordAudit({ action: "invalid_payload" });
    return json({ error: "Invalid webhook payload." }, 400);
  }

  const project = await repository.findProject(projectId, teamId ?? undefined);
  if (!project) {
    await repository.recordAudit({ action: "unknown_project", projectId });
    return json({ ok: true, duplicate: false }, 202);
  }

  const signature = request.headers.get("x-vercel-signature");
  if (
    !signature ||
    (!validSignature(rawBody, signature, project.secret) &&
      (!project.previousSecret || !validSignature(rawBody, signature, project.previousSecret)))
  ) {
    await repository.recordAudit({ action: "invalid_signature", projectId });
    return json({ ok: true, duplicate: false }, 202);
  }

  const deploymentId = stringValue(deployment?.id) ?? stringValue(payload.deploymentId);
  const eventType = stringValue(payload.type);
  if (!deploymentId || !eventType) {
    await repository.recordAudit({ action: "invalid_payload", projectId });
    return json({ error: "Invalid webhook payload." }, 400);
  }

  const meta =
    objectValue(deployment?.meta) ?? objectValue(envelope.meta) ?? objectValue(payload.meta);
  const deliveryHeader = request.headers.get("x-vercel-delivery")?.trim();
  const event: VercelWebhookEvent = {
    tenantId: project.tenantId,
    projectId: project.projectId,
    deploymentId,
    eventType,
    status: stringValue(deployment?.state) ?? null,
    url: normalizeUrl(stringValue(deployment?.url)),
    commitSha: stringValue(meta?.githubCommitSha) ?? null,
    payload: redactPayload(payload),
    occurredAt: eventTime(payload),
    ...(deliveryHeader ? { deliveryId: deliveryHeader } : {}),
  };
  try {
    const result = await repository.recordEvent(event);
    if (result.duplicate) {
      await repository.recordAudit({ action: "duplicate", projectId: project.projectId });
    }
    await repository.updateProjection?.(event);
    if (eventType === "deployment.error") await repository.recordFailureSignal?.(event);
    return json({ ok: true, duplicate: false }, 202);
  } catch (error) {
    await repository.recordAudit({ action: "processing_failed", projectId: project.projectId });
    throw error;
  }
}

function parsePayload(rawBody: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(rawBody);
    return objectValue(payload);
  } catch {
    return null;
  }
}

function validSignature(rawBody: string, signature: string, secret: string): boolean {
  const normalized = signature.trim();
  const providedValue = normalized.startsWith("sha1=")
    ? normalized.slice("sha1=".length)
    : normalized.startsWith("sha256=")
      ? normalized.slice("sha256=".length)
      : normalized;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(providedValue, "utf8");
  const actual = Buffer.from(expected, "utf8");
  return provided.length === actual.length && timingSafeEqual(provided, actual);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

function eventTime(payload: Record<string, unknown>): string {
  const value = payload.createdAt ?? payload.created ?? payload.timestamp;
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /secret|token|password|authorization|signature/i;
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !sensitive.test(key))
          .map(([key, item]) => [key, redact(item)])
      );
    return value;
  };
  return redact(payload) as Record<string, unknown>;
}
