// Paynow reconciliation sweep — webhook-independent payment completion.
//
// Paynow's resulturl webhook (/api/paynow/callback) is the primary
// settlement path, but webhooks can trail the buyer's redirect, get
// dropped by the network, or be misconfigured (wrong PAYNOW_RESULT_URL).
// A paid buyer must NEVER fall through to the 48h payment-SLA cancellation
// because a webhook went missing — so this sweep, started once per server
// process from instrumentation.ts (LIVE MODE ONLY), closes the loop:
//
//   lane 1 — status fairness sweep (R2): every 60s, pending sessions
//     older than 120s are re-polled on Paynow, IN A ROTATING BATCH: a
//     cursor remembers the last checked session id and the next sweep
//     continues after it (wrapping around at the end). Abandoned pending
//     sessions can therefore never monopolize the batch — every pending
//     session is checked at least once per full rotation (proven in
//     tests/paynow/reconcile-fairness.test.ts).
//
//   lane 2 — settlement recovery (R3): sessions already marked paid but
//     whose settlement did NOT complete (order still pending_payment, or
//     the paynow_settlements journal not done — a crash between writes)
//     are re-settled; settlePaidOrder is journal-guarded idempotent, so
//     repeats converge and never double-write. Only paid sessions touched
//     within the 48h payment-SLA window are considered.
//
// Idempotent by construction: settlePaidOrder claims the unique
// paynow_settlements journal row before writing and marks it done after
// the last write. A transition audit row (action "paynow:reconcile") is
// written only when a session actually changes state — signal, not noise.
//
// Mock mode: skipped entirely (mock sessions resolve through the hosted
// sandbox page → /api/paynow/sandbox, which drives the same settlement).

import { isMockMode, isSafeGatewayUrl, pollStatus } from "./paynow";
import {
  getSettlementByReference,
  patchSession,
  settlePaidOrder,
  toSessionRow,
} from "./paynow-order";
import { tbCreate, tbList, nowIso } from "./trailbase-admin";

/** Only re-check sessions that have been pending for at least this long —
 *  the buyer's return-page poll (every 4s) handles the hot path; this
 *  sweep is the cold backup, so it stays behind by 2 minutes. */
const SWEEP_MIN_AGE_MS = 120_000;
const SWEEP_LIMIT = 20;
/** Recovery lane horizon — matches the payment-SLA window. */
const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

const g = globalThis as unknown as {
  __tgsPaynowSweep?: NodeJS.Timeout;
  /** R2 fairness cursor — last session id checked by lane 1 (rotating). */
  __tgsPaynowSweepCursor?: number;
  __tgsPaynowRecoveryCursor?: number;
};

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

/** Gateway-reported amount vs the session amount (cents compare). */
function gatewayAmountMismatch(
  sessionAmount: number,
  gatewayAmount: string | undefined,
): string | null {
  if (gatewayAmount == null || gatewayAmount === "") return null;
  const n = Number(gatewayAmount);
  if (!Number.isFinite(n)) return gatewayAmount; // unparseable → mismatch
  return Math.round(n * 100) === Math.round(sessionAmount * 100)
    ? null
    : gatewayAmount;
}

export interface SweepResult {
  checked: number;
  updated: number;
  settled: number;
}

export interface RecoveryResult {
  checked: number;
  recovered: number;
}

/** Poll stale pending sessions on Paynow and apply their true status. */
export async function sweepPendingPaynowSessions(): Promise<SweepResult> {
  if (isMockMode()) return { checked: 0, updated: 0, settled: 0 };

  // R2 — rotating batch: continue after the last checked id so later
  // sessions cannot be starved by abandoned pending rows ahead of them.
  const cursor = g.__tgsPaynowSweepCursor ?? 0;
  const rows = await tbList("paynow_sessions", {
    "filter[status][$eq]": "pending",
    "filter[updated_at][$lte]": toSweepIso(SWEEP_MIN_AGE_MS),
    "filter[id][$gt]": cursor,
    order: "id",
    limit: SWEEP_LIMIT,
  });

  let updated = 0;
  let settled = 0;

  for (const raw of rows) {
    const session = toSessionRow(raw);
    if (!session || !session.poll_url) continue;

    if (!isSafeGatewayUrl(session.poll_url)) {
      // unsafe destination stored in the row — never call it (fail closed)
      continue;
    }

    let result;
    try {
      result = await pollStatus(session.poll_url);
    } catch {
      continue; // gateway hiccup — next sweep retries
    }
    if (result.status === "error" && !result.raw?.status) continue;

    const mismatch = gatewayAmountMismatch(session.amount, result.amount);
    if (mismatch != null) {
      // Gateway evidence does not match the session — never settle; mark
      // the session disputed for the support path and audit the signal.
      await patchSession(session, {
        status: "disputed",
        error: `amount-mismatch: gateway ${mismatch} vs session ${session.amount}`,
      });
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:reconcile",
        entity: "paynow_sessions",
        entity_id: session.id,
        source: "sweep",
        payload: JSON.stringify({
          reference: session.reference,
          from: session.status,
          to: "disputed",
          reason: "amount-mismatch",
          gatewayAmount: mismatch,
        }),
        created_at: nowIso(),
      });
      updated += 1;
      continue;
    }

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

  // Advance (or wrap) the fairness cursor. Wrapping whenever the batch
  // comes back short guarantees every eligible session is visited within
  // one full rotation — the anti-starvation proof.
  const lastId = rows.length
    ? Number(rows[rows.length - 1]?.id ?? 0)
    : 0;
  g.__tgsPaynowSweepCursor = rows.length < SWEEP_LIMIT ? 0 : lastId;

  return { checked: rows.length, updated, settled };
}

/**
 * R3 — settlement recovery: sessions marked paid whose settlement did not
 * finish (order not paid yet, or journal not done). settlePaidOrder is
 * idempotent (journal-guarded); completed sessions are skipped cheaply.
 */
export async function sweepSettlementRecovery(): Promise<RecoveryResult> {
  if (isMockMode()) return { checked: 0, recovered: 0 };

  const cursor = g.__tgsPaynowRecoveryCursor ?? 0;
  const rows = await tbList("paynow_sessions", {
    "filter[status][$eq]": "paid",
    "filter[updated_at][$gte]": toSweepIso(RECOVERY_WINDOW_MS),
    "filter[id][$gt]": cursor,
    order: "id",
    limit: SWEEP_LIMIT,
  });

  let recovered = 0;

  for (const raw of rows) {
    const session = toSessionRow(raw);
    if (!session) continue;

    const journal = await getSettlementByReference(session.reference);
    if (journal?.status === "done") continue; // fully settled — cheap skip

    // Journal missing or stale/pending → (re-)run the journal-guarded
    // settle: completes order/payment/notification/audit + marks done.
    const order = await settlePaidOrder(session);
    if (order?.status === "paid") recovered += 1;
  }

  const lastId = rows.length ? Number(rows[rows.length - 1]?.id ?? 0) : 0;
  g.__tgsPaynowRecoveryCursor = rows.length < SWEEP_LIMIT ? 0 : lastId;

  return { checked: rows.length, recovered };
}

/** Start the 60s sweep once per server process (live mode only). */
export function startPaynowSweep(): void {
  if (g.__tgsPaynowSweep) return;
  if (isMockMode()) return; // sandbox sessions resolve via /api/paynow/sandbox
  g.__tgsPaynowSweep = setInterval(() => {
    void sweepPendingPaynowSessions().catch((err) =>
      console.error("[paynow-sweep]", (err as Error).message),
    );
    void sweepSettlementRecovery().catch((err) =>
      console.error("[paynow-recovery]", (err as Error).message),
    );
  }, 60_000);
}
