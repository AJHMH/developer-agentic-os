import { AsyncLocalStorage } from "node:async_hooks";

export type HostedRequestContext = {
  correlationId: string;
  apiVersion: string;
  tenantId?: string;
  userId?: string;
};

export const hostedRequestContextStorage = new AsyncLocalStorage<HostedRequestContext>();

export function currentCorrelationId(): string | undefined {
  return hostedRequestContextStorage.getStore()?.correlationId;
}

export function currentApiVersion(): string | undefined {
  return hostedRequestContextStorage.getStore()?.apiVersion;
}

export function currentTenantId(): string | undefined {
  return hostedRequestContextStorage.getStore()?.tenantId;
}

export function runWithHostedContext<T>(
  context: HostedRequestContext,
  callback: () => Promise<T> | T
): Promise<T> | T {
  return hostedRequestContextStorage.run(context, callback);
}
