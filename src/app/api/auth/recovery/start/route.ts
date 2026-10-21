// POST /api/auth/recovery/start — account recovery, step 1 (IAM-007).
//
// Authority order (documented honestly):
//   1. trust-service /internal/recovery/start {username} — the intended
//      recovery authority (owner 12-c); returns {ok, code, sandbox?}.
//   2. FALLBACK when trust is provisioning: the BFF generates the 6-digit
//      code itself (sha256-hashed pending session, 15 min TTL, max 5 tries).
// Delivery: comms-service POST /events with the existing "account.security"
// template (securityNote carries the code) — the mock provider surfaces it
// in the comms mock viewer, exactly like the channel-verification wizard.
// SANDBOX HONESTY: when comms runs its mock providers (or trust flags
// sandbox), the response includes {sandbox:true, code} so the demo flow is
// completable without a real inbox — mirroring the comms "Sandbox preview".
// Anti-enumeration: unknown usernames return ok:true with no code.

import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  COMMS_BASE,
  findUserByUsername,
  startPendingRecovery,
  svcFetch,
  PORTS,
  trustPost,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  let body: { username?: string };
  try {
    body = (await req.json()) as { username?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ ok: false, error: "Enter your username." }, { status: 400 });
  }
  const user = findUserByUsername(username);
  if (!user) {
    // anti-enumeration: same shape, nothing sent, no code
    return NextResponse.json({ ok: true, sandbox: false });
  }

  // ── code authority: trust first, BFF fallback ──────────────────────────
  let code: string;
  let authority: "trust" | "bff";
  let trustSandbox = false;
  const trustRes = await trustPost("/internal/recovery/start", { username });
  if (trustRes.ok && trustRes.data && typeof trustRes.data.code === "string") {
    code = trustRes.data.code;
    authority = "trust";
    trustSandbox = trustRes.data.sandbox === true;
  } else {
    code = startPendingRecovery(username);
    authority = "bff";
  }

  // ── delivery via comms (fire-and-forget, 2s budget) ────────────────────
  const note = `Your Tengasell account recovery code is ${code}. It expires in 15 minutes. If you didn't request it, ignore this message and consider changing your password.`;
  let queued = 0;
  try {
    const res = await fetch(`${COMMS_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: username,
        eventKey: "account.security",
        params: { securityNote: note, location: "account recovery" },
        deepLink: "/#/signin",
      }),
      signal: AbortSignal.timeout(2000),
    });
    const data = (await res.json().catch(() => ({}))) as { queued?: number };
    queued = Number(data.queued ?? 0);
  } catch {
    /* comms down — sandbox code below still lets the demo flow complete */
  }

  // comms mock mode? (providers all mock ⇒ sandbox demo) — honest disclosure
  const commsHealth = await svcFetch(PORTS.comms, "/health", { timeoutMs: 1500 });
  const providers = (commsHealth.data?.providers ?? {}) as Record<string, string>;
  const commsMock =
    commsHealth.ok && Object.values(providers).length > 0 && Object.values(providers).every((m) => m === "mock");
  const sandbox = commsMock || trustSandbox;

  await writeAudit({
    user: userB64For(username),
    action: "account:recovery_started",
    entity: "auth",
    source: "web",
    payload: { username, ip: clientIp(req), authority, delivered: queued > 0, sandbox },
  });

  return NextResponse.json({
    ok: true,
    sandbox,
    queued,
    authority,
    ...(sandbox ? { code } : {}),
  });
}
