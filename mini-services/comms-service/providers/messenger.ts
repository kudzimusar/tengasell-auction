// Messenger provider — MESSENGER_PAGE_TOKEN set ⇒ real Graph API send
// (graph.facebook.com/<v>/me/messages), otherwise a fully functional MOCK
// transcript in mock_chats. Handles are "messenger:<psid>".

import { GRAPH_API_VERSION, MESSENGER_PAGE_TOKEN } from "../config";
import { nextMockId, recordMockChat } from "./mock";
import type { OutboundMessage, Provider, SendResult } from "./types";

interface GraphResponse {
  message_id?: string;
  recipient_id?: string;
  error?: { message?: string };
}

export function makeMessengerProvider(): Provider {
  const real = MESSENGER_PAGE_TOKEN !== "";
  return {
    channel: "messenger",
    mode: real ? "real" : "mock",
    label: real ? "graph" : "mock",
    async send(msg: OutboundMessage): Promise<SendResult> {
      if (!real) {
        recordMockChat("messenger", msg.to, "bot", msg.shortText, msg.queueId);
        return { ok: true, providerMsgId: nextMockId(), error: null };
      }
      const id = msg.to.startsWith("messenger:") ? msg.to.slice("messenger:".length) : msg.to;
      try {
        const res = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(MESSENGER_PAGE_TOKEN)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id },
              messaging_type: "RESPONSE",
              message: { text: msg.shortText },
            }),
          },
        );
        const data = (await res.json().catch(() => null)) as GraphResponse | null;
        if (!res.ok) {
          return { ok: false, providerMsgId: null, error: `messenger ${res.status}: ${data?.error?.message ?? "unknown error"}` };
        }
        return { ok: true, providerMsgId: data?.message_id ?? nextMockId(), error: null };
      } catch (e) {
        return { ok: false, providerMsgId: null, error: `messenger unreachable: ${String(e)}` };
      }
    },
  };
}
