# ADR 0004: Vercel Webhook Routing to Tenants

**Status**: Accepted; target design approved, implementation partial

**Date**: 2026-09-09
**Last Updated**: 2026-09-12

## Status Update

The tenant/project mapping and deployment-event schema are documented, but the live application currently exposes Vercel deployment polling rather than the shared webhook endpoint described here. The webhook contract below is therefore the approved target for the hosted implementation.

The system treats deployment events as tenant-scoped signals and associates them with the organization that owns that project.

## Context

Vercel fires webhooks for deployment events (started, succeeded, failed). In a multi-tenant system, we must route each webhook to the correct tenant/organization.

**Challenge**: Vercel webhooks don't inherently know which Clerk org they belong to. We need a mechanism to infer the tenant from the webhook payload.

## Decision

We will use **Vercel project ID ↔ tenant mapping** to route webhooks:

### Webhook Routing Flow

1. **Vercel fires a webhook** for a deployment event (e.g., `deployment.ready`)

   ```json
   {
     "type": "deployment.ready",
     "deploymentId": "dpl_...",
     "projectId": "prj_abc123",
     "meta": {
       "githubCommitSha": "abc123...",
       "githubOrg": "acme-corp",
       "githubRepo": "main-app"
     }
   }
   ```

2. **Our webhook endpoint receives it**

   ```
   POST /api/webhooks/vercel
   ```

3. **Look up tenant by Vercel project ID**

   ```sql
   SELECT tenant_id FROM vercel_projects
   WHERE vercel_project_id = 'prj_abc123'
   ```

4. **Process the event in that tenant's context**
   - Create deployment record with `tenant_id`
   - Update artifacts or work items scoped to that tenant
   - Send notifications to that org's members

### Database Schema

Extend `vercel_projects` table with webhook routing:

```sql
CREATE TABLE vercel_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_team_id VARCHAR(255),
  domain VARCHAR(255),
  webhook_secret VARCHAR(255), -- HMAC secret for webhook validation
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_project_id),
  INDEX idx_vercel_project (vercel_project_id)
);

-- Store deployment events
CREATE TABLE deployment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  vercel_project_id VARCHAR(255) NOT NULL,
  vercel_deployment_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'ready', 'error', etc.
  status VARCHAR(50), -- 'success', 'failed', 'running'
  url VARCHAR(255),
  commit_sha VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, vercel_deployment_id),
  INDEX idx_tenant_deployments (tenant_id),
  INDEX idx_vercel_project_id (vercel_project_id)
);
```

### Webhook Handler

```typescript
// POST /api/webhooks/vercel
export async function POST(req: Request) {
  const body = await req.json();
  const signature = req.headers.get("x-vercel-signature");

  // 1. Look up tenant by Vercel project ID
  const vercelProject = await db.vercel_projects.findUnique({
    where: { vercel_project_id: body.projectId },
  });

  if (!vercelProject) {
    // Project not registered; ignore or warn
    return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
  }

  // 2. Verify webhook signature (optional but recommended)
  const isValid = verifyWebhookSignature(body, signature, vercelProject.webhook_secret);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  // 3. Process event in tenant context
  const tenantId = vercelProject.tenant_id;
  await handleDeploymentEvent(tenantId, body);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleDeploymentEvent(tenantId: UUID, event: any) {
  // Record the deployment
  await db.deployment_events.create({
    tenant_id: tenantId,
    vercel_project_id: event.projectId,
    vercel_deployment_id: event.deploymentId,
    event_type: event.type,
    status: event.deployment?.state,
    url: event.deployment?.url,
    commit_sha: event.meta?.githubCommitSha,
  });

  // Create a signal or work item if deployment failed
  if (event.deployment?.state === "error") {
    await createFailureSignal(tenantId, event);
  }

  // Emit to connected developers (via WebSocket, polling, etc.)
  await notifyTenant(tenantId, {
    type: "deployment_event",
    event: event,
  });
}
```

## Resolved Design Rules

- A webhook is first persisted as an immutable tenant-scoped Deployment Event. An Incoming Signal is derived only for supported failure events; webhook processing does not automatically create a Work Item.
- `vercel_project_id` must resolve to one tenant. If Vercel permits project IDs to be reused across teams, the mapping key must include `vercel_team_id`.
- Signature verification reads the raw request body and uses the mapped project's active secret with a timing-safe comparison. During rotation, the active and previous secrets may both validate for a bounded transition window.
- Unknown projects and duplicate deliveries return a non-revealing `202 Accepted` response. Invalid signatures are rejected without revealing registration state. All such attempts are recorded in a platform-level webhook audit stream.
- Delivery idempotency uses Vercel's stable delivery ID when available, falling back to `(vercel_project_id, vercel_deployment_id, event_type)`. The deployment-level uniqueness constraint must not collapse `created`, `ready`, and `error` into one event.
- Immutable events are retained separately from a current deployment projection. Provider timestamps prevent late events from overwriting newer projected state.
- Events are assigned to the tenant resolved at receipt time. Project transfers do not retroactively move historical events.
- The endpoint returns success after durable persistence. Signal creation, notifications, and other side effects run asynchronously with internal retries; Vercel is not asked to retry them.
- Authorized operators may replay stored events, but replay is explicit, audited, idempotent, and subject to current authorization.
- Raw payloads are sensitive tenant data: redact unnecessary metadata, restrict access, and retain them for less time than normalized events. Unknown event types are stored as unhandled events without creating user-facing signals.

## Webhook Event Types

Vercel sends several event types. We track:

| Event                | Action                                         |
| -------------------- | ---------------------------------------------- |
| `deployment.ready`   | Deployment succeeded; show live URL            |
| `deployment.error`   | Build or deploy failed; create Incoming Signal |
| `deployment.created` | Build started; show status                     |
| `comment.created`    | (Future) Comment on PR from Vercel checks      |

For v1, we handle `ready` (success) and `error` (failure).

## Security Considerations

### Webhook Secret Validation

Vercel signs each webhook with an HMAC. We validate it:

```typescript
function verifyWebhookSignature(body: any, signature: string, secret: string): boolean {
  const json = JSON.stringify(body);
  const hash = crypto.createHmac("sha256", secret).update(json).digest("hex");

  return signature === hash;
}
```

### Store Secret Securely

- Generate a random secret when the Vercel project is registered
- Store encrypted in Neon (use `pgcrypto` or application-level encryption)
- Rotate secrets periodically

### Authenticate Webhook Origin

Even with signature validation:

- Only accept webhooks from Vercel's IP ranges (optional but extra layer)
- Log all webhook attempts for audit

## Failure Modes

| Scenario                                              | Response                             |
| ----------------------------------------------------- | ------------------------------------ |
| Webhook arrives but project not found in DB           | 404; log for investigation           |
| Signature invalid                                     | 401; log as potential security issue |
| Deployment event stored but tenant notification fails | 200 anyway; alert ops                |

## Related Decisions

- **ADR 0001**: Multi-tenancy with tenant_id
- **ADR 0003**: Per-tenant Vercel deployments
- **ADR 0002**: Clerk org → tenant mapping

## Current Status and Deferred Extensions

1. Deployment events currently route into tenant-scoped signals without auto-creating a Work Item by default.
   - The implemented pattern favors triage-first handling, with a user or workflow deciding whether a signal becomes an actionable Work Item.

2. A single shared webhook endpoint remains the current model.
   - The tenant is resolved from the mapped Vercel project, which keeps the routing simple and explicit.

3. Retention policy remains a later operational detail.
   - Deployment history is kept as part of the tenant-scoped data model, with timeline retention to be tuned if needed.

## References

- Vercel Webhooks: https://vercel.com/docs/integrations/webhooks
- HMAC validation: https://nodejs.org/api/crypto.html
- Neon encryption: https://neon.tech/docs/manage/sensitive-data
