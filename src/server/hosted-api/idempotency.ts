import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createHostedErrorResponse,
  HEADER_API_VERSION,
  HEADER_CORRELATION_ID,
  HEADER_IDEMPOTENT_REPLAYED,
  DEFAULT_API_VERSION,
} from "./contract";

export type StoredIdempotencyRecord = {
  key: string;
  tenantId: string;
  payloadHash: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  createdAt: string;
};

export class HostedIdempotencyStore {
  private static instance: HostedIdempotencyStore | null = null;
  private readonly records = new Map<string, StoredIdempotencyRecord>();

  static getInstance(): HostedIdempotencyStore {
    if (!HostedIdempotencyStore.instance) {
      HostedIdempotencyStore.instance = new HostedIdempotencyStore();
    }
    return HostedIdempotencyStore.instance;
  }

  private compositeKey(tenantId: string, key: string): string {
    return `${tenantId}:::${key}`;
  }

  async get(tenantId: string, key: string): Promise<StoredIdempotencyRecord | null> {
    const record = this.records.get(this.compositeKey(tenantId, key));
    return record ?? null;
  }

  async put(record: StoredIdempotencyRecord): Promise<void> {
    this.records.set(this.compositeKey(record.tenantId, record.key), record);
  }

  clear(): void {
    this.records.clear();
  }
}

export function hashPayload(payload: string | null | undefined): string {
  const normalized = (payload ?? "").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function evaluateIdempotency(
  store: HostedIdempotencyStore,
  tenantId: string,
  key: string,
  rawBody: string,
  correlationId: string,
  version: string = DEFAULT_API_VERSION
): Promise<
  | { type: "replay"; response: NextResponse }
  | { type: "mismatch"; errorResponse: NextResponse }
  | {
      type: "execute";
      save: (status: number, body: unknown, headers?: Record<string, string>) => Promise<void>;
    }
> {
  const currentHash = hashPayload(rawBody);
  const existing = await store.get(tenantId, key);

  if (existing) {
    if (existing.payloadHash !== currentHash) {
      return {
        type: "mismatch",
        errorResponse: createHostedErrorResponse({
          code: "IDEMPOTENCY_KEY_MISMATCH",
          message:
            "Idempotency key payload mismatch. A previous request was sent with the same idempotency key but different parameters.",
          status: 409,
          retryable: false,
          correlationId,
          version,
        }),
      };
    }

    const headers: Record<string, string> = {
      ...existing.headers,
      [HEADER_API_VERSION]: version,
      [HEADER_CORRELATION_ID]: correlationId,
      [HEADER_IDEMPOTENT_REPLAYED]: "true",
      "content-type": "application/json",
    };

    const replayed = new NextResponse(JSON.stringify(existing.body), {
      status: existing.status,
      headers,
    });

    return { type: "replay", response: replayed };
  }

  return {
    type: "execute",
    save: async (status: number, body: unknown, headers: Record<string, string> = {}) => {
      await store.put({
        key,
        tenantId,
        payloadHash: currentHash,
        status,
        headers,
        body,
        createdAt: new Date().toISOString(),
      });
    },
  };
}
