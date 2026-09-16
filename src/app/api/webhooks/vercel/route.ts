import { NextResponse } from "next/server";

import { NeonVercelWebhookRepository } from "@/server/hosted-deployments/neon-vercel-webhook-repository";
import { handleVercelWebhook } from "@/server/hosted-deployments/vercel-webhook";

export async function POST(request: Request): Promise<Response> {
  const repository = new NeonVercelWebhookRepository();
  try {
    return await handleVercelWebhook(request, repository);
  } catch (error) {
    console.error("Vercel webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  } finally {
    await repository.close();
  }
}
