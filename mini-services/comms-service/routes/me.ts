// User endpoints — /me/links, /me/preferences, /me/notifications.
// The user is identified by the x-tgs-user header set by the Next BFF.

import { HttpError, bodyStr, type AddRoute, type Ctx } from "../http";
import { get, insert, run, all } from "../db";
import { randCode6, randToken, nowIso, toIsoOut, clampInt, flagBool } from "../util";
import { CHANNELS, EVENTS, MARKETING_KEYS, isChannel } from "../taxonomy";
import { isMock } from "../providers";
import type { LinkRow } from "../emit";
import type { QueueRow } from "../queue";
import type { RelayLogRow } from "../relay";
import { effectivePrefs, marketingOptIn, upsertPrefs } from "../prefs";
import { linkOut, notificationSnippet, relayOut } from "./serialize";

function requireUser(ctx: Ctx): string {
  return ctx.requireUser();
}

function linkById(id: number, userId: string): LinkRow {
  const row = get<LinkRow>(`SELECT * FROM channel_links WHERE id = ?`, [id]);
  if (!row || row.user_id !== userId) throw new HttpError(404, "link not found", "not_found");
  return row;
}

// ── Link wizard instructions ──────────────────────────────────────────────────

function instructionsFor(channel: string, handle: string, locale: "en" | "ja"): string {
  if (locale === "ja") {
    switch (channel) {
      case "email":
        return `${handle} 宛に6桁の認証コードを送信しました。24時間以内に My Tengasell → Communications でコードを入力し、認証を完了してください。`;
      case "telegram":
        return "TelegramのTengasellボットで /start を送信してください。返信された6桁のコードをここに入力するとチャットが連携されます。";
      case "whatsapp":
        return `登録した番号（${handle}）からTengasellのWhatsAppラインに START と送信してください。返信されたコードをここに入力します。`;
      default:
        return "MessengerでTengasellアカウントに START を送信し、返信されたコードをここに入力してください。";
    }
  }
  switch (channel) {
    case "email":
      return `We sent a 6-digit verification code to ${handle}. Enter it in My Tengasell → Communications within 24 hours to finish linking.`;
    case "telegram":
      return "Open the Tengasell bot on Telegram and send /start. We'll reply with a 6-digit code — enter that code here to link your chat.";
    case "whatsapp":
      return `Send START to the Tengasell WhatsApp line from ${handle}. We'll reply with a code — enter it here to link the number.`;
    default:
      return "Send START to Tengasell on Messenger from your account, then enter the code we reply with here.";
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerMeRoutes(on: AddRoute): void {
  // GET /me/links → {links:[…]}
  on("GET", "/me/links", (ctx) => {
    const user = requireUser(ctx);
    const rows = all<LinkRow>(`SELECT * FROM channel_links WHERE user_id = ? ORDER BY channel ASC, id ASC`, [user]);
    return { links: rows.map(linkOut) };
  });

  // POST /me/links {channel,handle,displayLabel?} → {link, instructions, sandbox?}
  on("POST", "/me/links", (ctx) => {
    const user = requireUser(ctx);
    const channel = bodyStr(ctx, "channel", { required: true, max: 20 });
    if (!isChannel(channel)) throw new HttpError(400, `channel must be one of ${CHANNELS.join(", ")}`, "bad_channel");
    const rawHandle = bodyStr(ctx, "handle", { required: true, max: 320 });
    const handle = channel === "email" ? rawHandle.toLowerCase() : rawHandle;
    const displayLabel =
      typeof ctx.body?.displayLabel === "string" && ctx.body.displayLabel.trim()
        ? String(ctx.body.displayLabel).slice(0, 120)
        : null;

    const code = randCode6();
    const existing = get<{ id: number; status: string }>(
      `SELECT id, status FROM channel_links WHERE user_id = ? AND channel = ? AND handle = ?`,
      [user, channel, handle],
    );
    let id: number;
    if (existing) {
      // Same channel+handle re-submitted from the wizard:
      //   · disabled → revive the row (unlink → re-link round-trip)
      //   · pending  → re-send semantics: mint a fresh code for the SAME row
      //     (otherwise a user who backs out of step 2 can never get a code again)
      //   · verified → hard 409 (genuinely already linked)
      if (existing.status === "verified") {
        throw new HttpError(409, "this channel+handle is already linked", "already_linked");
      }
      id = existing.id;
      run(
        `UPDATE channel_links SET status = 'pending', display_label = ?, verify_token = ?, verify_code = ?,
           verified_at = NULL, created_at = ? WHERE id = ?`,
        [displayLabel, randToken(16), code, nowIso(), id],
      );
    } else {
      id = insert(
        `INSERT INTO channel_links(user_id, channel, handle, display_label, status, verify_token, verify_code, created_at)
         VALUES(?,?,?,?, 'pending', ?, ?, ?)`,
        [user, channel, handle, displayLabel, randToken(16), code, nowIso()],
      );
    }
    const row = get<LinkRow>(`SELECT * FROM channel_links WHERE id = ?`, [id]);
    const out: Record<string, unknown> = {
      link: linkOut(row!),
      instructions: { en: instructionsFor(channel, handle, "en"), ja: instructionsFor(channel, handle, "ja") },
    };
    // sandbox.verifyCode is exposed ONLY while the channel's provider is in mock mode.
    if (isMock(channel)) out.sandbox = { verifyCode: code };
    return out;
  });

  // POST /me/links/:id/verify {code} → {ok:true, link:{…,status:"verified"}}
  on("POST", "/me/links/:id/verify", (ctx) => {
    const user = requireUser(ctx);
    const row = linkById(Number(ctx.params.id), user);
    const code = bodyStr(ctx, "code", { required: true, max: 12 });
    if (row.status === "verified") {
      return { ok: true, link: linkOut(row) };
    }
    if (row.status !== "pending") throw new HttpError(409, `link is ${row.status}`, "bad_state");
    if (row.verify_code !== code) throw new HttpError(400, "invalid verification code", "invalid_code");
    run(`UPDATE channel_links SET status = 'verified', verified_at = ?, verify_code = NULL WHERE id = ?`, [nowIso(), row.id]);
    const updated = get<LinkRow>(`SELECT * FROM channel_links WHERE id = ?`, [row.id]);
    return { ok: true, link: linkOut(updated!) };
  });

  // POST /me/links/:id/disable → {ok:true}
  on("POST", "/me/links/:id/disable", (ctx) => {
    const user = requireUser(ctx);
    const row = linkById(Number(ctx.params.id), user);
    run(`UPDATE channel_links SET status = 'disabled' WHERE id = ?`, [row.id]);
    return { ok: true };
  });

  // GET /me/preferences → full matrix + marketingOptIn aggregate
  on("GET", "/me/preferences", (ctx) => {
    const user = requireUser(ctx);
    const matrix = EVENTS.map((def) => ({
      eventKey: def.key,
      labelEn: def.labelEn,
      labelJa: def.labelJa,
      group: def.group,
      default: def.defaults,
      user: effectivePrefs(user, def.key),
    }));
    return { matrix, marketingOptIn: marketingOptIn(user) };
  });

  // PUT /me/preferences {matrix:[{eventKey,email,telegram,whatsapp,messenger}], marketingOptIn:{…}}
  on("PUT", "/me/preferences", (ctx) => {
    const user = requireUser(ctx);
    const rawMatrix = ctx.body?.matrix;
    if (Array.isArray(rawMatrix)) {
      for (const entry of rawMatrix) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const eventKey = typeof e.eventKey === "string" ? e.eventKey : "";
        if (!EVENTS.some((d) => d.key === eventKey)) {
          throw new HttpError(400, `unknown eventKey: ${eventKey || "(missing)"}`, "bad_event_key");
        }
        // Only channels explicitly present in the entry are written; omitted ones keep their value.
        const values: Partial<{ email: 0 | 1; telegram: 0 | 1; whatsapp: 0 | 1; messenger: 0 | 1 }> = {};
        for (const ch of CHANNELS) {
          if (e[ch] !== undefined) values[ch] = flagBool(e[ch]) as 0 | 1;
        }
        upsertPrefs(user, eventKey, values);
      }
    }
    const optIn = ctx.body?.marketingOptIn;
    if (optIn && typeof optIn === "object" && !Array.isArray(optIn)) {
      const o = optIn as Record<string, unknown>;
      for (const key of MARKETING_KEYS) {
        const values: Partial<{ email: 0 | 1; telegram: 0 | 1; whatsapp: 0 | 1; messenger: 0 | 1 }> = {};
        for (const ch of CHANNELS) {
          if (o[ch] !== undefined) values[ch] = flagBool(o[ch]) as 0 | 1;
        }
        if (Object.keys(values).length > 0) upsertPrefs(user, key, values);
      }
    }
    return { ok: true };
  });

  // GET /me/notifications?limit=20 → outbound_queue rows for the user, newest first
  on("GET", "/me/notifications", (ctx) => {
    const user = requireUser(ctx);
    const limit = clampInt(ctx.url.searchParams.get("limit"), 20, 100);
    const rows = all<QueueRow>(
      `SELECT * FROM outbound_queue WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [user, limit],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        eventKey: r.template_key,
        channel: r.channel,
        subject: r.subject,
        snippet: notificationSnippet(r),
        threadId: r.thread_id,
        status: r.status,
        createdAt: toIsoOut(r.created_at),
      })),
    };
  });

  // GET /me/relay?threadId= → mediated-relay rows the user is party to
  // (Task 11-d — additive). Rows where direction='in' are cross-channel
  // replies (Telegram / WhatsApp / email-inbound) surfaced in thread views.
  // With ?threadId= rows come back oldest-first for merge-into-conversation;
  // without it, newest-first for a general glance.
  on("GET", "/me/relay", (ctx) => {
    const user = requireUser(ctx);
    const threadId = ctx.url.searchParams.get("threadId");
    const limit = clampInt(ctx.url.searchParams.get("limit"), 100, 300);
    const rows: RelayLogRow[] = threadId
      ? all<RelayLogRow>(
          `SELECT * FROM relay_log
           WHERE thread_id = ? AND (from_user_id = ? OR to_user_id = ?)
           ORDER BY id ASC LIMIT ?`,
          [threadId, user, user, limit],
        )
      : all<RelayLogRow>(
          `SELECT * FROM relay_log
           WHERE from_user_id = ? OR to_user_id = ?
           ORDER BY id DESC LIMIT ?`,
          [user, user, limit],
        );
    return { items: rows.map(relayOut) };
  });
}
