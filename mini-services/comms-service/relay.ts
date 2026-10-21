// Relay persistence — every mediated message (outbound or inbound) ALWAYS
// writes a relay_log row with content_original + masked_content + flags_json.

import { insert, get, run } from "./db";
import { moderate, type ModerationFlag, type Verdict } from "./moderation";
import { nowIso } from "./util";

export interface RelayLogRow {
  id: number;
  thread_id: string | null;
  direction: "out" | "in";
  from_user_id: string | null;
  to_user_id: string | null;
  channel: string | null;
  content_original: string | null;
  masked_content: string | null;
  flags_json: string | null;
  moderation_status: Verdict;
  created_at: string;
}

export interface LoggedModeration {
  status: Verdict;
  maskedContent: string;
  flags: ModerationFlag[];
  logId: number;
}

export function persistRelayLog(input: {
  threadId: string | null;
  direction: "out" | "in";
  fromUserId: string | null;
  toUserId: string | null;
  channel: string | null;
  contentOriginal: string;
  maskedContent: string;
  flags: ModerationFlag[];
  status: Verdict;
}): number {
  return insert(
    `INSERT INTO relay_log(thread_id, direction, from_user_id, to_user_id, channel, content_original, masked_content, flags_json, moderation_status, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [
      input.threadId,
      input.direction,
      input.fromUserId,
      input.toUserId,
      input.channel,
      input.contentOriginal,
      input.maskedContent,
      JSON.stringify(input.flags),
      input.status,
      nowIso(),
    ],
  );
}

/** Moderate then ALWAYS persist a relay_log row (the pinned pipeline behaviour). */
export function moderateAndLog(
  content: string,
  opts: {
    direction: "out" | "in";
    threadId?: string | null;
    fromUserId?: string | null;
    toUserId?: string | null;
    channel?: string | null;
    senderId?: string | null;
    skipRateLimit?: boolean;
  },
): LoggedModeration {
  const mod = moderate(content, {
    threadId: opts.threadId ?? null,
    senderId: opts.senderId ?? opts.fromUserId ?? null,
    skipRateLimit: opts.skipRateLimit,
  });
  const logId = persistRelayLog({
    threadId: opts.threadId ?? null,
    direction: opts.direction,
    fromUserId: opts.fromUserId ?? null,
    toUserId: opts.toUserId ?? null,
    channel: opts.channel ?? null,
    contentOriginal: content,
    maskedContent: mod.maskedContent,
    flags: mod.flags,
    status: mod.status,
  });
  return { ...mod, logId };
}

/** Last known counterpart participant on a thread (from relay history), excluding the sender. */
export function counterpartOnThread(threadId: string, excludeUserId: string): string | null {
  const row = get<{ from_user_id: string }>(
    `SELECT from_user_id FROM relay_log
     WHERE thread_id = ? AND from_user_id IS NOT NULL AND from_user_id != ?
     ORDER BY id DESC LIMIT 1`,
    [threadId, excludeUserId],
  );
  if (row) return row.from_user_id;
  const q = get<{ user_id: string }>(
    `SELECT user_id FROM outbound_queue
     WHERE thread_id = ? AND user_id IS NOT NULL AND user_id != ?
     ORDER BY id DESC LIMIT 1`,
    [threadId, excludeUserId],
  );
  return q?.user_id ?? null;
}

export function updateRelayStatus(id: number, status: Verdict): void {
  run(`UPDATE relay_log SET moderation_status = ? WHERE id = ?`, [status, id]);
}
