// GET /api/platform/flags — public feature-flag read (CTL-015/022).
//
// Public by design so any surface can reflect operational state without an
// admin session. Values only — the mutation trail (who/when/why) is only
// exposed in the admin Configuration console.

import { NextResponse } from "next/server";
import { readFlags } from "@/lib/server/platform";

export async function GET() {
  const flags = readFlags();
  return NextResponse.json({
    ok: true,
    flags: Object.fromEntries(flags.map((f) => [f.key, f.value])),
    updated_at: flags.find((f) => f.lastChangedAt)?.lastChangedAt ?? null,
  });
}
