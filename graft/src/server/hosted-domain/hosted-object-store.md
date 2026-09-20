# src/server/hosted-domain/hosted-object-store.ts

- HostedObjectStore · interface · L5-L11 — interface HostedObjectStore
- RejectingHostedObjectStore · class · L13-L21 — class RejectingHostedObjectStore implements HostedObjectStore
- put · method · L14-L16 — async put(): Promise<never>
- get · method · L18-L20 — async get(): Promise<never>
- LocalHostedObjectStore · class · L23-L57 — class LocalHostedObjectStore implements HostedObjectStore
- constructor · method · L26-L28 — constructor(root?: string)
- put · method · L30-L36 — async put(content: string | Uint8Array, contentType: string)
- get · method · L38-L56 — async get(reference: string): Promise<Uint8Array>
