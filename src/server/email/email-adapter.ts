import type { EmailAdapter, EmailProviderMessage } from "@/types/email";
import type { IntegrationAdapterStatus } from "@/types/integration";
import type { IncomingSignal } from "@/types/incoming-signal";
import type { WorkspaceContext } from "@/types/workspace";
import { IncomingSignalStore } from "../incoming-signals/incoming-signal-store";

const demoMessages: EmailProviderMessage[] = [
  {
    id: "demo-email-1",
    subject: "Welcome to the Agent Inbox",
    sender: "demo@example.test",
    body: "This local email signal is ready for triage.",
  },
  {
    id: "demo-email-2",
    subject: "Review the latest repository snapshot",
    sender: "demo@example.test",
    body: "A provider-neutral email adapter keeps this signal read-only.",
  },
];

export class LocalEmailAdapter implements EmailAdapter {
  private readonly configuredMessages: EmailProviderMessage[] | null;
  private readonly status: IntegrationAdapterStatus;

  constructor(
    private readonly root = process.cwd(),
    private readonly env: Record<string, string | undefined> = process.env
  ) {
    this.configuredMessages = parseConfiguredMessages(env);
    this.status = emailStatus(env, this.configuredMessages);
  }

  getStatus(): IntegrationAdapterStatus {
    return this.status;
  }

  async listMessages(): Promise<EmailProviderMessage[]> {
    return this.status.status === "disabled" ? [] : (this.configuredMessages ?? demoMessages);
  }

  /**
   * Sync email messages to incoming signals.
   * Accepts optional WorkspaceContext for DI; creates store from root if not provided.
   */
  async sync(
    repositoryId: string,
    context?: WorkspaceContext
  ): Promise<{ integration: IntegrationAdapterStatus; signals: IncomingSignal[] }> {
    const store = context?.incomingSignalStore ?? new IncomingSignalStore(this.root);
    const existing = await store.list({ repositoryId, source: "email" });
    const existingIds = new Set(existing.map((signal) => signal.sourceId));
    const messages = await this.listMessages();
    const created: IncomingSignal[] = [];

    for (const message of messages) {
      if (existingIds.has(message.id)) continue;
      created.push(
        await store.create({
          source: "email",
          sourceId: message.id,
          title: message.subject,
          body: formatBody(message),
          repositoryId,
        })
      );
    }

    return { integration: this.status, signals: [...created, ...existing] };
  }
}

export const emailAdapter = new LocalEmailAdapter();

function parseConfiguredMessages(
  env: Record<string, string | undefined>
): EmailProviderMessage[] | null {
  if (!env.EMAIL_PROVIDER) return null;
  if (!env.EMAIL_PROVIDER_DATA) return [];

  try {
    const parsed: unknown = JSON.parse(env.EMAIL_PROVIDER_DATA);
    if (!Array.isArray(parsed) || parsed.some((message) => !isEmailMessage(message))) return [];
    return parsed;
  } catch {
    return [];
  }
}

function isEmailMessage(value: unknown): value is EmailProviderMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<EmailProviderMessage>;
  return (
    typeof message.id === "string" &&
    Boolean(message.id.trim()) &&
    typeof message.subject === "string" &&
    Boolean(message.subject.trim()) &&
    (message.body === undefined || typeof message.body === "string") &&
    (message.sender === undefined || typeof message.sender === "string") &&
    (message.receivedAt === undefined || typeof message.receivedAt === "string")
  );
}

function emailStatus(
  env: Record<string, string | undefined>,
  messages: EmailProviderMessage[] | null
): IntegrationAdapterStatus {
  if (env.EMAIL_ENABLED === "false")
    return baseStatus("disabled", "Email adapter is disabled by configuration.");
  if (!env.EMAIL_PROVIDER)
    return baseStatus(
      "available",
      "Email is running in local demo mode. Set EMAIL_PROVIDER to configure a provider."
    );
  if (!env.EMAIL_PROVIDER_DATA)
    return baseStatus(
      "available",
      `Email provider ${env.EMAIL_PROVIDER} is configured and awaiting provider data.`
    );
  if (messages?.length === 0 && env.EMAIL_PROVIDER_DATA !== "[]")
    return baseStatus(
      "error",
      "Email provider data is invalid; expected a JSON array of messages."
    );
  return baseStatus("connected", `Email provider ${env.EMAIL_PROVIDER} data is connected.`);
}

function baseStatus(
  status: IntegrationAdapterStatus["status"],
  message: string
): IntegrationAdapterStatus {
  return {
    id: "email",
    name: "Email",
    kind: "email",
    required: false,
    status,
    capabilities: ["communication signals"],
    setup:
      "Email adapter is read-only: send, reply, delete, and full-client actions are unavailable.",
    message,
  };
}

function formatBody(message: EmailProviderMessage): string {
  const sender = message.sender ? `From: ${message.sender}\n\n` : "";
  const received = message.receivedAt ? `Received: ${message.receivedAt}\n\n` : "";
  return `${sender}${received}${message.body ?? ""}`.trim();
}
