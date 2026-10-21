// TUCS event taxonomy — the 15 pinned event keys, their groups, labels and
// DEFAULT channel preferences (contract section C).
// Defaults: transactional → email ON (requires a verified link to actually send),
// everything else OFF. marketing.* → ALL OFF (explicit opt-in only).

export type EventGroup = "Auctions" | "Offers" | "Messages" | "Payments" | "SLA" | "Bookings" | "Account" | "Saved Searches" | "Marketing";
export type ChannelPrefs = { email: 0 | 1; telegram: 0 | 1; whatsapp: 0 | 1; messenger: 0 | 1 };

export interface EventDef {
  key: string;
  group: EventGroup;
  labelEn: string;
  labelJa: string;
  defaults: ChannelPrefs;
}

const TX = (email = 1): ChannelPrefs => ({ email: email as 0 | 1, telegram: 0, whatsapp: 0, messenger: 0 });
const OFF = (): ChannelPrefs => ({ email: 0, telegram: 0, whatsapp: 0, messenger: 0 });

export const EVENTS: EventDef[] = [
  // Auctions
  { key: "auction.won", group: "Auctions", labelEn: "Auction won", labelJa: "落札成功", defaults: TX() },
  { key: "auction.outbid", group: "Auctions", labelEn: "Outbid", labelJa: "入札が上回られた", defaults: TX() },
  { key: "auction.ending_soon", group: "Auctions", labelEn: "Ending soon", labelJa: "まもなく終了", defaults: TX() },
  { key: "auction.sold", group: "Auctions", labelEn: "Auction sold", labelJa: "落札成立", defaults: TX() },
  { key: "auction.question", group: "Auctions", labelEn: "Buyer question", labelJa: "購入者からの質問", defaults: TX() },
  // Offers (Gap-8 Best-Offer)
  { key: "offer.received", group: "Offers", labelEn: "Offer received", labelJa: "オファー受信", defaults: TX() },
  { key: "offer.responded", group: "Offers", labelEn: "Offer response", labelJa: "オファー返答", defaults: TX() },
  // Messages
  { key: "message.received", group: "Messages", labelEn: "New message", labelJa: "新着メッセージ", defaults: TX() },
  // Payments
  { key: "payment.reminder", group: "Payments", labelEn: "Payment reminder", labelJa: "お支払いリマインダー", defaults: TX() },
  // SLA
  { key: "sla.warning", group: "SLA", labelEn: "SLA warning", labelJa: "SLA警告", defaults: TX() },
  // Bookings
  { key: "booking.confirmed", group: "Bookings", labelEn: "Booking confirmed", labelJa: "予約確定", defaults: TX() },
  { key: "booking.reminder", group: "Bookings", labelEn: "Booking reminder", labelJa: "予約リマインダー", defaults: TX() },
  // Account
  { key: "comms.verify", group: "Account", labelEn: "Channel verification", labelJa: "チャネル認証", defaults: TX() },
  { key: "account.security", group: "Account", labelEn: "Security alert", labelJa: "セキュリティ通知", defaults: TX() },
  // Saved searches (Gap-8 alerts)
  { key: "search.alert", group: "Saved Searches", labelEn: "Saved-search match", labelJa: "保存検索の一致", defaults: TX() },
  // Marketing — explicit opt-in only
  { key: "marketing.digest", group: "Marketing", labelEn: "Weekly digest", labelJa: "週間ダイジェスト", defaults: OFF() },
  { key: "marketing.spotlight", group: "Marketing", labelEn: "Spotlight deals", labelJa: "スポットライト", defaults: OFF() },
  { key: "marketing.winback", group: "Marketing", labelEn: "Win-back offer", labelJa: "復帰オファー", defaults: OFF() },
];

export const EVENT_KEYS: ReadonlySet<string> = new Set(EVENTS.map((e) => e.key));

export const MARKETING_KEYS: string[] = EVENTS.filter((e) => e.group === "Marketing").map((e) => e.key);

const BY_KEY = new Map<string, EventDef>(EVENTS.map((e) => [e.key, e]));

export function eventDef(key: string): EventDef | null {
  return BY_KEY.get(key) ?? null;
}

export function isMarketingKey(key: string): boolean {
  return key.startsWith("marketing.");
}

export const CHANNELS = ["email", "telegram", "whatsapp", "messenger"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}
