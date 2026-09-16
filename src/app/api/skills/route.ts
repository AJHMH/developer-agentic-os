import { NextResponse } from "next/server";

import { skillRegistry } from "@/server/skills/skill-registry";

export async function GET() {
  return NextResponse.json({ skills: skillRegistry.listSkills() });
}
