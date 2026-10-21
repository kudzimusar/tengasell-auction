// Telegram provider — TELEGRAM_BOT_TOKEN set ⇒ real Bot API (sendMessage),
// otherwise a fully functional MOCK that appends the rendered short_text to
// mock_chats (role 'bot') as a live transcript. Handles are "telegram:<chat_id>".

import { TELEGRAM_BOT_TOKEN } from "../config";
import { nextMockId, recordMockChat } from "./mock";
import type { InboundMessage, InboundParse, OutboundMessage, Provider, SendResult } from "./types";

interface BotApiUpdate {
  update_id?: number;
  message?: BotApiMessage;
  edited_message?: BotApiMessage;
}

interface BotApiMessage {
  message_id?: number;
  from?: { id?: number; username?: string; first_name?: string };
  chat?: { id?: number; type?: string };
  text?: string;
}

interface BotApiResponse {
  ok?: boolean;
  result?: { message_id?: number };
  description?: string;
}

export function makeTelegramProvider(): Provider {
  const real = TELEGRAM_BOT_TOKEN !== "";
  const provider: Provider = {
    channel: "telegram",
    mode: real ? "real" : "mock",
    label: real ? "bot" : "mock",
    async send(msg: OutboundMessage): Promise<SendResult> {
      if (!real) {
        recordMockChat("telegram", msg.to, "bot", msg.shortText, msg.queueId);
        return { ok: true, providerMsgId: nextMockId(), error: null };
      }
      const chatId = msg.to.startsWith("telegram:") ? msg.to.slice("telegram:".length) : msg.to;
      try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg.shortText, disable_web_page_preview: false }),
        });
        const data = (await res.json().catch(() => null)) as BotApiResponse | null;
        if (!res.ok || !data?.ok) {
          return { ok: false, providerMsgId: null, error: `telegram ${res.status}: ${data?.description ?? "unknown error"}` };
        }
        return { ok: true, providerMsgId: String(data.result?.message_id ?? nextMockId()), error: null };
      } catch (e) {
        return { ok: false, providerMsgId: null, error: `telegram unreachable: ${String(e)}` };
      }
    },
    parseInbound(payload: unknown): InboundParse {
      const updates = Array.isArray(payload) ? (payload as BotApiUpdate[]) : [payload as BotApiUpdate];
      const messages: InboundMessage[] = [];
      for (const upd of updates) {
        const m = upd?.message ?? upd?.edited_message;
        if (!m || typeof m.text !== "string" || m.chat?.id == null) continue;
        messages.push({
          handle: `telegram:${m.chat.id}`,
          chatId: String(m.chat.id),
          text: m.text,
          messageId: m.message_id != null ? String(m.message_id) : null,
          fromName: m.from?.username ?? m.from?.first_name ?? null,
        });
      }
      return { messages, statuses: [] };
    },
  };
  return provider;
}
