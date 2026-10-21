// Provider contract shared by all channel adapters.

import type { Channel } from "../taxonomy";

export interface OutboundMessage {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  shortText: string;
  locale: string;
  queueId: number;
  deepLink: string | null;
}

export interface SendResult {
  ok: boolean;
  providerMsgId: string | null;
  error: string | null;
}

export interface InboundMessage {
  /** Normalized link handle, e.g. "telegram:123456" / "whatsapp:26377…". */
  handle: string;
  chatId: string | null;
  text: string;
  messageId: string | null;
  fromName: string | null;
}

export interface InboundStatus {
  /** Upstream message id of the SENT message (maps to outbound_queue.provider_msg_id). */
  messageId: string;
  status: string;
  to: string | null;
}

export interface InboundParse {
  messages: InboundMessage[];
  statuses: InboundStatus[];
}

export interface Provider {
  channel: Channel;
  mode: "mock" | "real";
  /** Health label per contract: "mock"|"resend"|"bot"|"cloud"|"graph". */
  label: string;
  send(msg: OutboundMessage): Promise<SendResult>;
  parseInbound?(payload: unknown): InboundParse;
}
