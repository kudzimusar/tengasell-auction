// Paynow reconciliation sweep — webhook-independent payment completion.
//
// Paynow's resulturl webhook (/api/paynow/callback) is the primary
// settlement path, but webhooks can trail the buyer's redirect, get
// dropped by the network, or be misconfigured (wrong PAYNOW_RESULT_URL).
// A paid buyer must NEVER fall through to the 48h payment-SLA cancellation
// because a webhook went missing — so this sweep, started once per server
// process from instrumentation.ts (LIVE MODE ONLY), closes the loop:
//
//   every 60s → paynow_sessions where status="pending" and older than
//   120s → GET {pollurl} on Paynow → apply paid/cancelled/failed/disputed
//   → settle paid sessions exactly like the webhook does (payments row,
//   seller notification, audit event, finance order.paid).
//
// Idempotent by construction: settlePaidOrder guards on the order status,
// de-duplicates payments rows by reference, and an in-process settle lock
// keeps concurrent sweeps/webhooks/polls from double-writing. A transition
// audit row (action "paynow:reconcile") is written only when a session
// actually changes state, so the audit trail stays signal, not noise.
//
// Mock mode: skipped entirely (mock sessions resolve through the hosted
// sandbox page → /api/paynow/sandbox, which drives the same settlement).

import { isMockMode, pollStatus } from "./paynow";
import { patchSession, settlePaidOrder, toSessionRow } from "./paynow-order";
import { tbCreate, tbList, nowIso } from "./trailbase-admin";

/** Only re-check sessions that have been pending for at least this long —
 *  the buyer's return-page poll (every 4s) handles the hot path; this
 *  sweep is the cold backup, so it stays behind by 2 minutes. */
const SWEEP_MIN_AGE_MS = 120_000;
const SWEEP_LIMIT = 20;

const g = globalThis as unknown as { __tgsPaynowSweep?: NodeJS.Timeout };

function toSweepIso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, "Z");
}

/** Normalize a pollStatus() result into a paynow_sessions status value. */
function sessionStatusFromPoll(result: Awaited<ReturnType<typeof pollStatus>>): string {
  if (result.paid) return "paid";
  if (result.failed) return "failed";
  if (result.cancelled) return "cancelled";
  if (result.disputed) return "disputed";
  return "pending";
}

export interface SweepResult {
  checked: number;
  updated: number;
  settled: number;
}

/** Poll stale pending sessions on Paynow and apply their true status. */
export async function sweepPendingPaynowSessions(): Promise<SweepResult> {
  if (isMockMode()) return { checked: 0, updated: 0, settled: 0 };

  const rows = await tbList("paynow_sessions", {
    "filter[status][$eq]": "pending",
    "filter[updated_at][$lte]": toSweepIso(SWEEP_MIN_AGE_MS),
    limit: SWEEP_LIMIT,
  });

  let updated = 0;
  let settled = 0;

  for (const raw of rows) {
    const session = toSessionRow(raw);
    if (!session || !session.poll_url) continue;

    let result;
    try {
      result = await pollStatus(session.poll_url);
    } catch {
      continue; // gateway hiccup — next sweep retries
    }
    if (result.status === "error" && !result.raw?.status) continue;

    const next = sessionStatusFromPoll(result);
    if (next === "pending" || next === session.status) continue;

    await patchSession(session, { status: next });
    await tbCreate("audit_events", {
      user: null,
      action: "paynow:reconcile",
      entity: "paynow_sessions",
      entity_id: session.id,
      source: "sweep",
      payload: JSON.stringify({
        reference: session.reference,
        from: session.status,
        to: next,
        paynowReference: result.paynowReference ?? null,
      }),
      created_at: nowIso(),
    });
    updated += 1;

    if (next === "paid") {
      const order = await settlePaidOrder({ ...session, status: next });
      if (order) settled += 1;
    }
  }

  return { checked: rows.length, updated, settled };
}

/** Start the 60s sweep once per server process (live mode only). */
export function startPaynowSweep(): void {
  if (g.__tgsPaynowSweep) return;
  if (isMockMode()) return; // sandbox sessions resolve via /api/paynow/sandbox
  g.__tgsPaynowSweep = setInterval(() => {
    void sweepPendingPaynowSessions().catch((err) =>
      console.error("[paynow-sweep]", (err as Error).message),
    );
  }, 60_000);
}
