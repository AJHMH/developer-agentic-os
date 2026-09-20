# src/server/email/email-adapter.ts

- LocalEmailAdapter · class · L22-L71 — class LocalEmailAdapter implements EmailAdapter
- constructor · method · L26-L32 — constructor( private readonly root = process.cwd(), private readonly env: Record<string, string | undefined> = process.env )
- getStatus · method · L34-L36 — getStatus(): IntegrationAdapterStatus
- listMessages · method · L38-L40 — async listMessages(): Promise<EmailProviderMessage[]>
- sync · method · L46-L70 — async sync( repositoryId: string, context?: WorkspaceContext ): Promise<{ integration: IntegrationAdapterStatus; signals: IncomingSignal[] }>
- parseConfiguredMessages · function · L75-L88 — function parseConfiguredMessages( env: Record<string, string | undefined> ): EmailProviderMessage[] | null
- isEmailMessage · function · L90-L102 — function isEmailMessage(value: unknown): value is EmailProviderMessage
- emailStatus · function · L104-L126 — function emailStatus( env: Record<string, string | undefined>, messages: EmailProviderMessage[] | null ): IntegrationAdapterStatus
- baseStatus · function · L128-L143 — function baseStatus( status: IntegrationAdapterStatus["status"], message: string ): IntegrationAdapterStatus
- formatBody · function · L145-L149 — function formatBody(message: EmailProviderMessage): string
