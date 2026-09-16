import type { IntegrationAdapterStatus } from "./integration";
import type { IncomingSignal } from "./incoming-signal";

export type EmailProviderMessage = {
  id: string;
  subject: string;
  body?: string;
  sender?: string;
  receivedAt?: string;
};

export type EmailAdapterResult = {
  integration: IntegrationAdapterStatus;
  signals: IncomingSignal[];
};

export type EmailAdapter = {
  getStatus(): IntegrationAdapterStatus;
  listMessages(): Promise<EmailProviderMessage[]>;
  sync(repositoryId: string): Promise<EmailAdapterResult>;
};
