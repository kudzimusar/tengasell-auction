// Mock channel storage — the mock providers render real template output into
// mock_inbox (email) and mock_chats (telegram/whatsapp/messenger) so the admin
// console has pixel-accurate transcripts without any network calls.

import { get, insert } from "../db";

let seq = 0;

/**
 * Seed the mock id sequence from existing row counts. Provably monotonic across
 * hot reloads: every issued mock-<seq> N satisfies N ≤ count(inbox) + count(chats)
 * at boot time (each send inserted a row; user-echo rows only add more), so the
 * reseeded counter never re-issues an id. (A MAX(id) seed would underestimate
 * when sends are split across the two tables.)
 */
export function initMockSeq(): void {
  const inbox = get<{ n: number }>(`SELECT COUNT(*) AS n FROM mock_inbox`);
  const chats = get<{ n: number }>(`SELECT COUNT(*) AS n FROM mock_chats`);
  seq = Number(inbox?.n ?? 0) + Number(chats?.n ?? 0);
}

export function nextMockId(): string {
  seq += 1;
  return `mock-${seq}`;
}

/** "telegram:81001" → "81001" (bare chat id for transcript rows). */
export function chatIdOf(channel: string, handle: string): string {
  const prefix = `${channel}:`;
  return handle.startsWith(prefix) ? handle.slice(prefix.length) : handle;
}

export function recordMockInbox(to: string, subject: string, html: string, text: string, queueId: number): void {
  insert(`INSERT INTO mock_inbox(to_addr, subject, html, text, queue_id) VALUES(?,?,?,?,?)`, [
    to,
    subject,
    html,
    text,
    queueId,
  ]);
}

export function recordMockChat(
  channel: string,
  handle: string,
  role: "bot" | "user",
  text: string,
  queueId: number | null,
): void {
  insert(`INSERT INTO mock_chats(channel, chat_id, role, text, queue_id) VALUES(?,?,?,?,?)`, [
    channel,
    chatIdOf(channel, handle),
    role,
    text,
    queueId,
  ]);
}
