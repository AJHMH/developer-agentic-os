import { NextResponse } from "next/server";

import { hostedInfrastructureError } from "@/app/api/hosted/_shared";
import { NeonVercelWebhookRepository } from "@/server/hosted-deployments/neon-vercel-webhook-repository";
import {
  handleVercelWebhook,
  type VercelWebhookRepository,
} from "@/server/hosted-deployments/vercel-webhook";

type ClosableVercelWebhookRepository = VercelWebhookRepository & {
  close?: () => Promise<void>;
};

export async function handleVercelWebhookRequest(
  request: Request,
  repository: ClosableVercelWebhookRepository = new NeonVercelWebhookRepository()
): Promise<Response> {
  try {
    return await handleVercelWebhook(request, repository);
  } catch (error) {
    const infrastructure = hostedInfrastructureError(error);
    if (infrastructure) return infrastructure;
    console.error("Vercel webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  } finally {
    await repository.close?.();
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleVercelWebhookRequest(request);
}
