// WhatsApp provider — WHATSAPP_TOKEN + WHATSAPP_PHONE_ID set ⇒ real Cloud API
// (graph.facebook.com/<phone_id>/messages), otherwise a fully functional MOCK
// transcript in mock_chats. Inbound payload shape = Cloud API webhooks
// (entry[].changes[].value.messages[] / statuses[]). Handles are "whatsapp:<wa_id>".
// Signature verification (X-Hub-Signature-256) is performed by the hook route
// using WHATSAPP_APP_SECRET — see routes/hooks.ts.

import { GRAPH_API_VERSION, WHATSAPP_PHONE_ID, WHATSAPP_TOKEN } from "../config";
import { nextMockId, recordMockChat } from "./mock";
import type { InboundMessage, InboundParse, InboundStatus, OutboundMessage, Provider, SendResult } from "./types";

interface CloudPayload {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        messaging_product?: string;
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[];
        statuses?: { id?: string; status?: string; recipient_id?: string }[];
      };
    }[];
  }[];
}

interface GraphResponse {
  messages?: { id?: string }[];
  error?: { message?: string };
}

export function makeWhatsAppProvider(): Provider {
  const real = WHATSAPP_TOKEN !== "" && WHATSAPP_PHONE_ID !== "";
  const provider: Provider = {
    channel: "whatsapp",
    mode: real ? "real" : "mock",
    label: real ? "cloud" : "mock",
    async send(msg: OutboundMessage): Promise<SendResult> {
      if (!real) {
        recordMockChat("whatsapp", msg.to, "bot", msg.shortText, msg.queueId);
        return { ok: true, providerMsgId: nextMockId(), error: null };
      }
      const to = msg.to.startsWith("whatsapp:") ? msg.to.slice("whatsapp:".length) : msg.to;
      try {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_ID}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { body: msg.shortText, preview_url: false },
          }),
        });
        const data = (await res.json().catch(() => null)) as GraphResponse | null;
        if (!res.ok) {
          return { ok: false, providerMsgId: null, error: `whatsapp ${res.status}: ${data?.error?.message ?? "unknown error"}` };
        }
        return { ok: true, providerMsgId: data?.messages?.[0]?.id ?? nextMockId(), error: null };
      } catch (e) {
        return { ok: false, providerMsgId: null, error: `whatsapp unreachable: ${String(e)}` };
      }
    },
    parseInbound(payload: unknown): InboundParse {
      const p = payload as CloudPayload;
      const messages: InboundMessage[] = [];
      const statuses: InboundStatus[] = [];
      for (const entry of p?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value;
          for (const m of value?.messages ?? []) {
            if (!m?.from || typeof m.text?.body !== "string") continue;
            const contact = (value?.contacts ?? []).find((c) => c.wa_id === m.from);
            messages.push({
              handle: `whatsapp:${m.from}`,
              chatId: m.from,
              text: m.text.body,
              messageId: m.id ?? null,
              fromName: contact?.profile?.name ?? null,
            });
          }
          for (const s of value?.statuses ?? []) {
            if (s?.id && s.status) {
              statuses.push({ messageId: s.id, status: s.status, to: s.recipient_id ?? null });
            }
          }
        }
      }
      return { messages, statuses };
    },
  };
  return provider;
}
