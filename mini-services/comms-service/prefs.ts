// Preference resolution — defaults from the taxonomy when no user row exists;
// user rows always win (contract section C). Marketing requires explicit opt-in
// (default 0 on every marketing.* key).

import { get, run } from "./db";
import { CHANNELS, MARKETING_KEYS, eventDef, type ChannelPrefs } from "./taxonomy";

export interface PrefRow {
  user_id: string;
  event_key: string;
  email: number;
  telegram: number;
  whatsapp: number;
  messenger: number;
}

export function prefRow(userId: string, eventKey: string): PrefRow | null {
  return get<PrefRow>(`SELECT * FROM preferences WHERE user_id = ? AND event_key = ?`, [userId, eventKey]);
}

/** Effective channel prefs for one event key: user row wins, else taxonomy default. */
export function effectivePrefs(userId: string, eventKey: string): ChannelPrefs {
  const def = eventDef(eventKey);
  const row = prefRow(userId, eventKey);
  if (row) {
    return {
      email: row.email === 1 ? 1 : 0,
      telegram: row.telegram === 1 ? 1 : 0,
      whatsapp: row.whatsapp === 1 ? 1 : 0,
      messenger: row.messenger === 1 ? 1 : 0,
    };
  }
  return def?.defaults ?? { email: 0, telegram: 0, whatsapp: 0, messenger: 0 };
}

export function upsertPrefs(
  userId: string,
  eventKey: string,
  values: Partial<ChannelPrefs>,
): void {
  const current = prefRow(userId, eventKey);
  const resolve = (v: 0 | 1 | undefined, prev: number | undefined): 0 | 1 =>
    v !== undefined ? (v === 1 ? 1 : 0) : prev === 1 ? 1 : 0;
  const merged: ChannelPrefs = {
    email: resolve(values.email, current?.email),
    telegram: resolve(values.telegram, current?.telegram),
    whatsapp: resolve(values.whatsapp, current?.whatsapp),
    messenger: resolve(values.messenger, current?.messenger),
  };
  run(
    `INSERT INTO preferences(user_id, event_key, email, telegram, whatsapp, messenger)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(user_id, event_key)
     DO UPDATE SET email = excluded.email, telegram = excluded.telegram, whatsapp = excluded.whatsapp, messenger = excluded.messenger`,
    [userId, eventKey, merged.email, merged.telegram, merged.whatsapp, merged.messenger],
  );
}

/** Marketing opt-in aggregate across marketing.* keys for the /me/preferences matrix. */
export function marketingOptIn(userId: string): ChannelPrefs {
  const out: ChannelPrefs = { email: 0, telegram: 0, whatsapp: 0, messenger: 0 };
  for (const key of MARKETING_KEYS) {
    const row = prefRow(userId, key);
    if (!row) continue;
    for (const ch of CHANNELS) {
      if (row[ch] === 1) out[ch] = 1;
    }
  }
  return out;
}

/** Turn marketing OFF for one user + channel (unsubscribe / complaint handling). */
export function prefsOffMarketing(userId: string, channel: string): void {
  if (!(CHANNELS as readonly string[]).includes(channel)) return;
  const ch = channel as keyof ChannelPrefs;
  for (const key of MARKETING_KEYS) {
    run(
      `INSERT INTO preferences(user_id, event_key, ${ch})
       VALUES(?,?,0)
       ON CONFLICT(user_id, event_key)
       DO UPDATE SET ${ch} = 0`,
      [userId, key],
    );
  }
}
