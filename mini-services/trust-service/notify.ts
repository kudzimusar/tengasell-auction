// TUCS comms bridge + takedown notification fan-out.
//
// §F of the 12-plan master contract lists NEW comms event keys
// (ticket.created, dispute.opened, …) to be added additively. The comms
// /events endpoint validates eventKey against its HARDCODED 15-key taxonomy
// (mini-services/comms-service/taxonomy.ts — owned by 11-c, frozen), so
// trust events CANNOT register new keys without editing frozen comms files.
// Honest v1 behaviour (documented in agent-ctx/12-c-trust.md):
//   · every user notice writes a TrailBase notifications row (in-app bell),
//   · every notice is recorded in trust.db notifications_log (GOV-010
//     evidence — visible in the admin console),
//   · security-relevant notices (takedown, suspension, ban, reinstatement)
//     ALSO fan out through comms /events using the EXISTING
//     "account.security" key, which semantically fits Trust & Safety notices
//     and delivers to every verified channel per the user's preference
//     matrix. When the comms taxonomy grows the new keys, swapping the key
//     here is a one-line change.

import { COMMS_BASE, APP_URL } from "./config";
import { insert } from "./db";
import { nowIso } from "./util";
import { notifyUser, userUuid } from "./trailbase";

export interface NoticeInput {
  username: string;
  /** Internal notice key — recorded in notifications_log (e.g. "trust.takedown"). */
  eventKey: string;
  title: string;
  body: string;
  /** In-app deep link (hash route). */
  link?: string;
  /** Fan out through TUCS /events (account.security key) when true. */
  viaComms?: boolean;
}

function commsPost(path: string, payload: Record<string, unknown>): void {
  void fetch(`${COMMS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  })
    .then((res) => {
      if (!res.ok) console.warn(`[trust→comms] ${path} → HTTP ${res.status}`);
    })
    .catch((err) => console.warn(`[trust→comms] ${path} unreachable:`, (err as Error).message));
}

/**
 * Record + deliver one user notice. Never throws — notification failures
 * must not block the admin action that triggered them.
 */
export async function userNotice(input: NoticeInput): Promise<void> {
  // 1. GOV-010 evidence row (immutable log, surfaced in the console).
  insert(
    `INSERT INTO notifications_log(event, username, payload, created_at) VALUES(?,?,?,?)`,
    [
      input.eventKey,
      input.username,
      JSON.stringify({ title: input.title, body: input.body, link: input.link ?? null }),
      nowIso(),
    ],
  );
  // 2. In-app bell notification (TrailBase).
  const uuid = await userUuid(input.username);
  if (uuid) {
    await notifyUser(
      uuid,
      "trust",
      input.title,
      input.body,
      input.link ? `${APP_URL}/#${input.link}` : "",
    );
  }
  // 3. Optional channel fan-out through TUCS (existing "account.security" key).
  if (input.viaComms) {
    commsPost("/events", {
      userId: input.username,
      eventKey: "account.security",
      params: { subject: input.title, detail: input.body },
      locale: "en",
      deepLink: input.link ? `${APP_URL}/#${input.link}` : null,
    });
  }
}

/** Fire-and-forget admin alert (report.received §F) — TUCS event to staff. */
export function commsEvent(
  userId: string,
  eventKey: string,
  params: Record<string, string | number | null | undefined>,
): void {
  commsPost("/events", { userId, eventKey, params, locale: "en" });
}
