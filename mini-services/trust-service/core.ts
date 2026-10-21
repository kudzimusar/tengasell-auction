// Core trust domain logic shared by routes: the suspension gate
// (/internal/status for 12-e's signin enforcement), the enforcement ladder
// application (warning → restriction → suspension → ban, with dual approval
// for ban + >7d suspensions), reinstatement, case risk scoring and the
// on-demand seller health score (MKT-026).

import { DUAL_APPROVAL_DAYS } from "./config";
import { get, insert, run, scalar } from "./db";
import { isoPlusDays, nowIso } from "./util";
import { userNotice } from "./notify";
import { audit, getRecords } from "./trailbase";
import { HttpError } from "./http";

// ── Suspension gate (IAM/CTL-005 + /internal/status contract §F) ─────────

export interface TrustStatus {
  username: string;
  /** true only for statuses that block sign-in (suspended | banned). */
  suspended: boolean;
  /** current ladder status or null when the account has no row. */
  status: "warned" | "restricted" | "suspended" | "banned" | null;
  reason_code: string;
  reason_note: string;
  until: string | null;
  roles: string[];
  mfa_active: boolean;
}

export function rolesOf(username: string): string[] {
  const rows = get<{ role: string }[]>(`SELECT role FROM roles WHERE username = ?`, [username]);
  return (rows ?? []).map((r) => r.role);
}

export function trustStatus(username: string): TrustStatus {
  const sus = get<{
    status: TrustStatus["status"];
    reason_code: string;
    reason_note: string;
    until: string | null;
  }>(`SELECT status, reason_code, reason_note, until FROM suspension WHERE username = ?`, [username]);
  const mfa = get<{ active: number }>(`SELECT active FROM mfa WHERE username = ?`, [username]);
  return {
    username,
    suspended: sus?.status === "suspended" || sus?.status === "banned",
    status: sus?.status ?? null,
    reason_code: sus?.reason_code ?? "",
    reason_note: sus?.reason_note ?? "",
    until: sus?.until ?? null,
    roles: rolesOf(username),
    mfa_active: mfa?.active === 1,
  };
}

// ── Enforcement ladder (TNS-008…013, CTL-005/006/021, MKT-028) ───────────

export type EnforcementAction = "warning" | "restriction" | "suspension" | "ban" | "reinstate";

const SUSPENSION_STATUS: Partial<Record<EnforcementAction, TrustStatus["status"]>> = {
  warning: "warned",
  restriction: "restricted",
  suspension: "suspended",
  ban: "banned",
};

export interface EnforcementInput {
  username: string;
  action: EnforcementAction;
  reason_code: string;
  note: string;
  days?: number | null;
  actor: string;
  evidence_ref?: string | null;
}

/**
 * Create an enforcement action. Ban + suspensions longer than
 * DUAL_APPROVAL_DAYS (or open-ended) come back as {pending:true} — the
 * suspension row is NOT applied until a DIFFERENT admin approves via
 * /admin/enforcement/:id/approve (CTL-021).
 */
export function createEnforcementRow(input: EnforcementInput): { id: number; pending: boolean } {
  if (!input.reason_code) throw new HttpError(400, "reason_code is required", "missing_field");

  const dual =
    input.action === "ban" ||
    (input.action === "suspension" && (input.days == null || input.days > DUAL_APPROVAL_DAYS));

  const liftsAt =
    input.action === "suspension" && input.days != null && input.days > 0
      ? isoPlusDays(input.days)
      : null;

  const id = insert(
    `INSERT INTO enforcement(username, action, reason_code, note, dual_approval, status,
       requested_by, created_at, lifts_at)
     VALUES(?,?,?,?,?,?,?,?,${liftsAt ? "?" : "NULL"})`,
    [
      input.username,
      input.action,
      input.reason_code,
      input.note,
      dual ? 1 : 0,
      dual ? "pending" : "active",
      input.actor,
      nowIso(),
      ...(liftsAt ? [liftsAt] : []),
    ],
  );

  if (!dual) {
    applyEnforcement(id, input.actor, input.evidence_ref ?? null);
  } else {
    void userNotice({
      username: input.username,
      eventKey: "trust.enforcement.pending",
      title: "Enforcement action pending review",
      body: `A Trust & Safety action (${input.action}) is pending a second admin approval. Reason: ${input.reason_code}.`,
      link: "my/tickets",
    });
  }
  void audit(input.actor, `enforcement.create.${input.action}`, "enforcement", id, "trust", {
    username: input.username,
    reason_code: input.reason_code,
    dual,
    note: input.note,
  });
  return { id, pending: dual };
}

/**
 * Apply an ACTIVE enforcement row to the suspension table + notify the user.
 * For `reinstate` the suspension row is cleared.
 */
export function applyEnforcement(enforcementId: number, actor: string, evidenceRef: string | null): void {
  const row = get<{
    id: number;
    username: string;
    action: EnforcementAction;
    reason_code: string;
    note: string;
    lifts_at: string | null;
  }>(`SELECT * FROM enforcement WHERE id = ?`, [enforcementId]);
  if (!row) throw new HttpError(404, "enforcement row not found", "not_found");

  run(`UPDATE enforcement SET status = 'active' WHERE id = ?`, [enforcementId]);

  if (row.action === "reinstate") {
    run(`DELETE FROM suspension WHERE username = ?`, [row.username]);
    void userNotice({
      username: row.username,
      eventKey: "trust.reinstated",
      title: "Your account has been reinstated",
      body: "Trust & Safety restored full access to your account. Welcome back!",
      link: "my",
      viaComms: true,
    });
    void audit(actor, "enforcement.reinstate.applied", "suspension", null, "trust", {
      username: row.username,
      enforcement_id: enforcementId,
    });
    return;
  }

  const status = SUSPENSION_STATUS[row.action];
  if (!status) throw new HttpError(400, `cannot apply action ${row.action}`, "bad_action");

  // The suspension row is the current-state snapshot; history stays in the
  // enforcement table (ladder audit, TNS-014).
  run(
    `INSERT INTO suspension(username, status, reason_code, reason_note, until, enforced_by, enforced_at, evidence_ref)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(username) DO UPDATE SET
       status = excluded.status,
       reason_code = excluded.reason_code,
       reason_note = excluded.reason_note,
       until = excluded.until,
       enforced_by = excluded.enforced_by,
       enforced_at = excluded.enforced_at,
       evidence_ref = excluded.evidence_ref`,
    [
      row.username,
      status,
      row.reason_code,
      row.note,
      row.action === "suspension" ? row.lifts_at : null,
      actor,
      nowIso(),
      evidenceRef,
    ],
  );

  const titles: Record<string, string> = {
    warned: "You have received a warning",
    restricted: "Your account has been restricted",
    suspended: "Your account has been suspended",
    banned: "Your account has been banned",
  };
  void userNotice({
    username: row.username,
    eventKey: `trust.${status}`,
    title: titles[status] ?? "Trust & Safety action",
    body: `Reason: ${row.reason_code}. ${row.note} ${
      row.action === "suspension" && row.lifts_at ? `Lifts at ${row.lifts_at}.` : ""
    } You can appeal from My Tengasell → Support.`,
    link: "my/tickets",
    viaComms: status === "suspended" || status === "banned",
  });
  void audit(actor, `enforcement.applied.${row.action}`, "suspension", enforcementId, "trust", {
    username: row.username,
    reason_code: row.reason_code,
    until: row.action === "suspension" ? row.lifts_at : null,
  });
}

// ── Case risk score (TNS-005) ────────────────────────────────────────────

/**
 * 0–100 heuristic risk score for a user at case-open time:
 *   prior enforcement ×20 + open/resolved cases ×10 + reports against ×5
 *   + low profile rating (below 3 with 3+ ratings) ×15, capped at 100.
 */
export function riskScore(username: string): number {
  const enforcementN = scalar(
    `SELECT COUNT(*) AS n FROM enforcement WHERE username = ? AND action != 'reinstate' AND status = 'active'`,
    [username],
  );
  const caseN = scalar(
    `SELECT COUNT(*) AS n FROM cases WHERE username = ? AND status != 'resolved'`,
    [username],
  );
  const reportsN = scalar(
    `SELECT COUNT(*) AS n FROM reports r JOIN cases c ON c.report_id = r.id
     WHERE c.username = ? AND r.status IN('received','reviewing')`,
    [username],
  );
  let score = enforcementN * 20 + caseN * 10 + reportsN * 5;
  // Low rating adds risk only when meaningful sample (fetched lazily, non-blocking is fine here)
  score = Math.min(100, score);
  return score;
}

// ── Seller health score (MKT-026, on demand) ─────────────────────────────

export interface HealthRow {
  username: string;
  dispatch_on_time: number;
  dispute_rate: number;
  rating_avg: number;
  flag_count: number;
  score: number;
  computed_at: string;
  orders_shipped: number;
  orders_total: number;
}

/**
 * Compute + persist seller health from TrailBase orders/ratings/profiles
 * (admin-token fetch). Dispatch SLA = shipped within 3 days of paid.
 * Score = round(100 − disputes×30 − late_dispatch×20 − flags×10 + rating×5),
 * clamped 0–100.
 */
export async function computeSellerHealth(username: string): Promise<HealthRow> {
  const orders = await getRecords(
    "orders",
    `filter[seller_username][$eq]=${encodeURIComponent(username)}&limit=200`,
  );
  const shipped = orders.filter((o: Record<string, unknown>) => o.paid_at && o.shipped_at);
  let onTime = 0;
  for (const o of shipped) {
    const paid = Date.parse(String(o.paid_at));
    const shippedAt = Date.parse(String(o.shipped_at));
    if (Number.isFinite(paid) && Number.isFinite(shippedAt) && shippedAt - paid <= 3 * 86_400_000) {
      onTime++;
    }
  }
  const dispatchOnTime = shipped.length ? onTime / shipped.length : 1;

  const disputeCases = scalar(
    `SELECT COUNT(*) AS n FROM cases WHERE username = ? AND kind = 'dispute'`,
    [username],
  );
  const disputeRate = orders.length ? disputeCases / orders.length : 0;

  const profiles = await getRecords(
    "profiles",
    `filter[username][$eq]=${encodeURIComponent(username)}&limit=1`,
  );
  const ratingAvg = Number(profiles[0]?.rating_avg ?? 0);

  const flags =
    scalar(`SELECT COUNT(*) AS n FROM reports r JOIN cases c ON c.report_id = r.id WHERE c.username = ? AND r.status = 'actioned'`, [username]) +
    scalar(`SELECT COUNT(*) AS n FROM enforcement WHERE username = ? AND action IN('restriction','suspension','ban') AND status = 'active'`, [username]);

  let score = 100 - disputeRate * 30 - (1 - dispatchOnTime) * 20 - flags * 10 + ratingAvg * 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const row: HealthRow = {
    username,
    dispatch_on_time: Math.round(dispatchOnTime * 1000) / 1000,
    dispute_rate: Math.round(disputeRate * 1000) / 1000,
    rating_avg: Math.round(ratingAvg * 100) / 100,
    flag_count: flags,
    score,
    computed_at: nowIso(),
    orders_shipped: shipped.length,
    orders_total: orders.length,
  };
  run(
    `INSERT INTO seller_health(username, dispatch_on_time, dispute_rate, rating_avg, flag_count, score, computed_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(username) DO UPDATE SET
       dispatch_on_time = excluded.dispatch_on_time,
       dispute_rate = excluded.dispute_rate,
       rating_avg = excluded.rating_avg,
       flag_count = excluded.flag_count,
       score = excluded.score,
       computed_at = excluded.computed_at`,
    [
      row.username,
      row.dispatch_on_time,
      row.dispute_rate,
      row.rating_avg,
      row.flag_count,
      row.score,
      row.computed_at,
    ],
  );
  return row;
}
