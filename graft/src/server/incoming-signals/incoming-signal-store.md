# src/server/incoming-signals/incoming-signal-store.ts

- IncomingSignalError · class · L19-L27 — class IncomingSignalError extends Error
- constructor · method · L20-L26 — constructor( readonly code: "INVALID_INPUT" | "NOT_FOUND", message: string )
- IncomingSignalStore · class · L29-L100 — class IncomingSignalStore
- constructor · method · L30-L30 — constructor(private readonly root = process.cwd())
- list · method · L32-L42 — async list(options: ListIncomingSignalsOptions = {}): Promise<IncomingSignal[]>
- create · method · L44-L64 — async create(input: CreateIncomingSignalInput): Promise<IncomingSignal>
- update · method · L66-L90 — async update( id: string, input: UpdateIncomingSignalInput, repositoryId?: string ): Promise<IncomingSignal>
- readSignals · method · L92-L95 — private async readSignals(): Promise<IncomingSignal[]>
- writeSignals · method · L97-L99 — private async writeSignals(signals: IncomingSignal[]): Promise<void>
- validateCreate · function · L104-L123 — function validateCreate(input: CreateIncomingSignalInput): void
- isProvider · function · L125-L127 — function isProvider(value: unknown): value is IncomingSignalProvider
- validateUpdate · function · L129-L150 — function validateUpdate(input: UpdateIncomingSignalInput): void
