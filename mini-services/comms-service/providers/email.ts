// Email provider — RESEND_API_KEY set ⇒ real Resend adapter (POST /emails),
// otherwise a fully functional MOCK that renders the branded template HTML into
// mock_inbox so the admin console can preview pixel-accurate emails.

import { EMAIL_FROM, RESEND_API_KEY } from "../config";
import type { Provider, OutboundMessage, SendResult } from "./types";
import { nextMockId, recordMockInbox } from "./mock";

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

export function makeEmailProvider(): Provider {
  const real = RESEND_API_KEY !== "";
  return {
    channel: "email",
    mode: real ? "real" : "mock",
    label: real ? "resend" : "mock",
    async send(msg: OutboundMessage): Promise<SendResult> {
      if (!real) {
        recordMockInbox(msg.to, msg.subject, msg.bodyHtml, msg.bodyText, msg.queueId);
        return { ok: true, providerMsgId: nextMockId(), error: null };
      }
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [msg.to],
            subject: msg.subject,
            html: msg.bodyHtml,
            text: msg.bodyText,
          }),
        });
        const data = (await res.json().catch(() => null)) as ResendResponse | null;
        if (!res.ok) {
          return { ok: false, providerMsgId: null, error: `resend ${res.status}: ${data?.message ?? data?.name ?? "unknown error"}` };
        }
        return { ok: true, providerMsgId: data?.id ?? nextMockId(), error: null };
      } catch (e) {
        return { ok: false, providerMsgId: null, error: `resend unreachable: ${String(e)}` };
      }
    },
  };
}
