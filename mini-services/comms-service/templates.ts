// TUCS templates — all 15 pinned keys in BOTH locales (en + ja).
// Email bodies are NXS-branded 600px table layouts with inline CSS using the
// exact teal/gold hexes from the Next app's globals.css. 44px-height CTA
// buttons. Marketing templates carry an {unsubUrl} link in the footer.
// Every email footer: "Tengasell · Harare, Zimbabwe · © 2025".
// Storage: one row per (key, channel='email'|'short', locale) — idempotent upsert on boot.

import { BRAND } from "./config";
import { insert, get, run } from "./db";
import { escapeHtml, nowIso } from "./util";
import { EVENTS } from "./taxonomy";

export interface TemplateDef {
  subject: string;
  paragraphs: string[];
  cta?: string;
  short: string;
  unsub?: boolean;
}

export interface TemplateRow {
  id: number;
  key: string;
  channel: string;
  locale: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  short_text: string | null;
  active: number;
}

// ── NXS-branded 600px email layout (inline CSS only) ─────────────────────────

function brandEmailHtml(def: TemplateDef, locale: string): string {
  const B = BRAND;
  const paragraphs = def.paragraphs
    .map((t) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:${B.ink};">${t}</p>`)
    .join("");
  const cta = def.cta
    ? `<div style="margin:28px 0 6px 0;"><a href="{deepUrl}" style="display:inline-block;height:44px;line-height:44px;padding:0 34px;background:${B.teal};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;">${def.cta}</a></div>` +
      `<div style="font-size:12px;line-height:18px;color:${B.muted};margin-top:10px;word-break:break-all;">{deepUrl}</div>`
    : "";
  const unsubLine = def.unsub
    ? `<div style="font-size:12px;line-height:18px;color:${B.muted};margin-top:6px;">` +
      `<a href="{unsubUrl}" style="color:${B.goldDeep};text-decoration:underline;">${locale === "ja" ? "配信停止" : "Unsubscribe"}</a>` +
      ` · ${locale === "ja" ? "マーケティング通知は My Tengasell → Communications で管理できます。" : "Manage channels in My Tengasell → Communications."}</div>`
    : "";
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(def.subject)}</title></head>
<body style="margin:0;padding:0;background:${B.canvas};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.canvas};padding:28px 10px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${B.hairline};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue','Noto Sans JP',sans-serif;">
<tr><td style="padding:26px 40px 18px 40px;">
  <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;line-height:1;"><span style="color:${B.teal};">Tenga</span><span style="color:${B.gold};">Sell</span></div>
  <div style="font-size:12px;color:${B.muted};margin-top:6px;">a snap to your happy deal</div>
</td></tr>
<tr><td style="height:3px;background:${B.gold};font-size:0;line-height:3px;">&nbsp;</td></tr>
<tr><td style="padding:32px 40px 10px 40px;">
  <h1 style="margin:0 0 14px 0;font-size:21px;line-height:30px;color:${B.tealDeep};">${escapeHtml(def.subject)}</h1>
  ${paragraphs}
  ${cta}
</td></tr>
<tr><td style="padding:22px 40px 26px 40px;border-top:1px solid ${B.hairline};">
  <div style="font-size:12px;line-height:18px;color:${B.muted};">Tengasell · Harare, Zimbabwe · © 2025</div>
  ${unsubLine}
</td></tr>
</table>
<div style="font-size:11px;color:${B.muted};margin-top:12px;">${locale === "ja" ? "これはTengasellからのサービス通知です。" : "This is a service message from Tengasell."}</div>
</td></tr>
</table>
</body>
</html>`;
}

function brandEmailText(def: TemplateDef): string {
  return [def.subject, "", ...def.paragraphs, "", `Open: {deepUrl}`].join("\n");
}

// ── The 15 pinned template keys × en/ja ──────────────────────────────────────

const CONTENT: Record<string, { en: TemplateDef; ja: TemplateDef }> = {
  "comms.verify": {
    en: {
      subject: "Verify your channel on Tengasell",
      paragraphs: [
        "Your verification code is {code}.",
        "Enter it in My Tengasell → Communications to link this channel to your account. The code expires in 24 hours — if you didn't request it, you can ignore this message.",
      ],
      cta: "Open Comms Center",
      short: "Tengasell: your verification code is {code}. Enter it in My Tengasell → Communications. {deepUrl}",
    },
    ja: {
      subject: "Tengasell チャネル認証コード",
      paragraphs: [
        "認証コードは {code} です。",
        "My Tengasell → Communications でコードを入力するとチャネルが連携されます。有効期限は24時間です。心当たりがない場合は無視してください。",
      ],
      cta: "Comms Centerを開く",
      short: "Tengasell：認証コードは {code} です。My Tengasell → Communications で入力してください。 {deepUrl}",
    },
  },
  "auction.won": {
    en: {
      subject: "You won “{auctionTitle}”!",
      paragraphs: [
        "Congratulations! Your bid of {amount} won “{auctionTitle}”.",
        "Pay within 48 hours to lock in the deal — after that the SLA clock may release the item back to auction.",
      ],
      cta: "Pay now",
      short: "🎉 You won “{auctionTitle}” for {amount}! Pay within 48h. {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」の落札に成功しました！",
      paragraphs: [
        "おめでとうございます！入札額 {amount} で「{auctionTitle}」を落札しました。",
        "48時間以内にお支払いください。期限を過ぎると商品が再出品される場合があります。",
      ],
      cta: "今すぐ支払う",
      short: "🎉 「{auctionTitle}」を {amount} で落札！48時間以内に支払いを。 {deepUrl}",
    },
  },
  "auction.outbid": {
    en: {
      subject: "You were outbid on “{auctionTitle}”",
      paragraphs: [
        "Someone placed a higher bid of {amount} on “{auctionTitle}”.",
        "There's still time — set your maximum bid and let proxy bidding fight for you in the final seconds.",
      ],
      cta: "Bid again",
      short: "📈 You were outbid on “{auctionTitle}” (now {amount}). Bid again: {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」で入札が上回られました",
      paragraphs: [
        "他の入札者が {amount} で入札しました。",
        "まだ時間はあります。最大入札額を設定すると、代理入札が自動で対応します。",
      ],
      cta: "再入札する",
      short: "📈 「{auctionTitle}」で {amount} を上回られました。再入札：{deepUrl}",
    },
  },
  "auction.ending_soon": {
    en: {
      subject: "“{auctionTitle}” ends in {timeLeft}",
      paragraphs: [
        "“{auctionTitle}” closes in {timeLeft}. Final bids count most — the anti-snipe rule extends the clock if bids land in the last 5 minutes.",
      ],
      cta: "View auction",
      short: "⏱ “{auctionTitle}” ends in {timeLeft} — final bids now: {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」はまもなく終了（残り {timeLeft}）",
      paragraphs: [
        "「{auctionTitle}」は {timeLeft}後に終了します。終了5分前に入札があると延長される場合があります。",
      ],
      cta: "オークションを見る",
      short: "⏱ 「{auctionTitle}」終了まで {timeLeft}：{deepUrl}",
    },
  },
  "auction.sold": {
    en: {
      subject: "Your “{auctionTitle}” sold for {amount}",
      paragraphs: [
        "Great news — “{auctionTitle}” sold for {amount}.",
        "Arrange delivery with the buyer and keep everything on Tengasell so the SLA protects you both.",
      ],
      cta: "View order",
      short: "💰 “{auctionTitle}” sold for {amount}! Arrange delivery: {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」が {amount} で落札されました",
      paragraphs: [
        "「{auctionTitle}」が {amount} で売れました！",
        "購入者と配送を調整しましょう。取引はTengasell内で完遂するとSLAで保護されます。",
      ],
      cta: "注文を見る",
      short: "💰 「{auctionTitle}」が {amount} で落札！配送手配へ：{deepUrl}",
    },
  },
  "auction.question": {
    en: {
      subject: "New question on “{auctionTitle}”",
      paragraphs: [
        "{fromLabel} asked: “{snippet}”",
        "Answer quickly — responsive sellers rank higher in Harare search.",
      ],
      cta: "Answer now",
      short: "❓ {fromLabel} asked about “{auctionTitle}”: {snippet} — reply: {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」に新しい質問",
      paragraphs: [
        "{fromLabel} からの質問：「{snippet}」",
        "素早い回答は検索順位アップにつながります。",
      ],
      cta: "回答する",
      short: "❓ {fromLabel} が「{auctionTitle}」について質問：{snippet} → {deepUrl}",
    },
  },
  "message.received": {
    en: {
      subject: "New message from {fromLabel}",
      paragraphs: [
        "{fromLabel} sent you a message:",
        "“{snippet}”",
        "Keep conversations on Tengasell — contact details are scrubbed automatically for your protection.",
      ],
      cta: "Open thread",
      short: "💬 {fromLabel}: “{snippet}” — reply on Tengasell: {deepUrl}",
    },
    ja: {
      subject: "{fromLabel} から新着メッセージ",
      paragraphs: [
        "{fromLabel} からのメッセージ：",
        "「{snippet}」",
        "やり取りはTengasell内で。連絡先情報は保護のため自動的にマスクされます。",
      ],
      cta: "スレッドを開く",
      short: "💬 {fromLabel}：「{snippet}」→ {deepUrl}",
    },
  },
  "payment.reminder": {
    en: {
      subject: "Payment due: {orderRef} ({amount})",
      paragraphs: [
        "Your order {orderRef} — {itemName} — awaits payment of {amount}.",
        "The 48-hour payment SLA is due {dueAt}. Unpaid orders auto-release the item back to the seller.",
      ],
      cta: "Pay now",
      short: "💳 Order {orderRef} ({amount}) due {dueAt}. Pay securely: {deepUrl}",
    },
    ja: {
      subject: "お支払いのお願い：{orderRef}（{amount}）",
      paragraphs: [
        "注文 {orderRef}（{itemName}）のお支払い {amount} が確定待ちです。",
        "48時間の支払いSLAの期限は {dueAt} です。未払いの場合は商品が自動解放されます。",
      ],
      cta: "今すぐ支払う",
      short: "💳 注文 {orderRef}（{amount}）の期限は {dueAt}。お支払い：{deepUrl}",
    },
  },
  "sla.warning": {
    en: {
      subject: "SLA warning: {slaLabel} at {dueAt}",
      paragraphs: [
        "Heads up: {slaLabel} for order {orderRef} is due {dueAt}.",
        "Missing SLA steps triggers {penalty} — act now to keep your rating clean.",
      ],
      cta: "View order",
      short: "⚠️ SLA: {slaLabel} due {dueAt} (order {orderRef}). {deepUrl}",
    },
    ja: {
      subject: "SLA警告：{slaLabel}（{dueAt}）",
      paragraphs: [
        "注文 {orderRef} の {slaLabel} は {dueAt} に期限を迎えます。",
        "期限超過は {penalty} の対象になります。今すぐ対応してください。",
      ],
      cta: "注文を見る",
      short: "⚠️ SLA：{slaLabel} は {dueAt}（注文 {orderRef}）。{deepUrl}",
    },
  },
  "booking.confirmed": {
    en: {
      subject: "Booking {bookingRef} confirmed",
      paragraphs: [
        "Your collection booking {bookingRef} is confirmed for {bookingAt} at {location}.",
        "Bring your reference number and ID. You can reschedule up to 2 hours before the slot.",
      ],
      cta: "View booking",
      short: "✅ Booking {bookingRef} confirmed — {bookingAt} at {location}. {deepUrl}",
    },
    ja: {
      subject: "予約 {bookingRef} が確定しました",
      paragraphs: [
        "受け取り予約 {bookingRef} が {bookingAt}（{location}）で確定しました。",
        "参照番号と身分証明書をご持参ください。2時間前まで再予約可能です。",
      ],
      cta: "予約を見る",
      short: "✅ 予約 {bookingRef} 確定 — {bookingAt}（{location}）。{deepUrl}",
    },
  },
  "booking.reminder": {
    en: {
      subject: "Reminder: booking {bookingRef} at {bookingAt}",
      paragraphs: [
        "This is your reminder for booking {bookingRef}: {bookingAt} at {location}.",
        "Need to move it? Reply in the booking thread.",
      ],
      cta: "View booking",
      short: "⏰ Booking {bookingRef} — {bookingAt} at {location}. {deepUrl}",
    },
    ja: {
      subject: "リマインダー：予約 {bookingRef}（{bookingAt}）",
      paragraphs: [
        "予約 {bookingRef} のリマインダー：{bookingAt}（{location}）。",
        "変更が必要な場合は予約スレッドでご返信ください。",
      ],
      cta: "予約を見る",
      short: "⏰ 予約 {bookingRef} — {bookingAt}（{location}）。{deepUrl}",
    },
  },
  "account.security": {
    en: {
      subject: "Security alert on your account",
      paragraphs: [
        "{securityNote}",
        "If this wasn't you, change your password immediately and review your linked channels.",
      ],
      cta: "Review activity",
      short: "🔐 Tengasell security: {securityNote} ({location}). Review: {deepUrl}",
    },
    ja: {
      subject: "アカウントのセキュリティ通知",
      paragraphs: [
        "{securityNote}",
        "心当たりがない場合は、すぐにパスワードを変更し、連携チャネルをご確認ください。",
      ],
      cta: "アクティビティを確認",
      short: "🔐 Tengasellセキュリティ：{securityNote}（{location}）。確認：{deepUrl}",
    },
  },
  "marketing.digest": {
    en: {
      subject: "Your Tengasell weekly digest",
      paragraphs: [
        "This week on Tengasell: {spotlightTitle} plus {dealCount} fresh deals ending soon across Harare.",
        "Signed, the Tengasell team — a snap to your happy deal.",
      ],
      cta: "Explore this week's deals",
      short: "🛍 Your weekly Tengasell digest is here — {spotlightTitle} + {dealCount} deals ending soon. {deepUrl}",
      unsub: true,
    },
    ja: {
      subject: "Tengasell 週間ダイジェスト",
      paragraphs: [
        "今週のTengasell：{spotlightTitle} ほか、ハラレの締め間近 {dealCount} 件。",
        "Tengasellチームより — a snap to your happy deal。",
      ],
      cta: "今週の取引を見る",
      short: "🛍 週間ダイジェスト到着 — {spotlightTitle}＋締め間近 {dealCount} 件。{deepUrl}",
      unsub: true,
    },
  },
  "marketing.spotlight": {
    en: {
      subject: "Spotlight: {spotlightTitle}",
      paragraphs: [
        "This week's spotlight: {spotlightTitle} — {spotlightBlurb}",
        "The auction ends soon and bidding is heating up.",
      ],
      cta: "View spotlight",
      short: "⭐ Spotlight: {spotlightTitle} — {spotlightBlurb}. Bid now: {deepUrl}",
      unsub: true,
    },
    ja: {
      subject: "スポットライト：{spotlightTitle}",
      paragraphs: [
        "今週のスポットライト：{spotlightTitle} — {spotlightBlurb}",
        "まもなく締め切り。入札が活発です。",
      ],
      cta: "スポットライトを見る",
      short: "⭐ スポットライト：{spotlightTitle} — {spotlightBlurb}。入札：{deepUrl}",
      unsub: true,
    },
  },
  "marketing.winback": {
    en: {
      subject: "We saved a deal for you",
      paragraphs: [
        "It's been a while! Your saved searches have {dealCount} new matches, and your first win-back auction has no reserve price.",
        "Come back this week and the welcome is on us.",
      ],
      cta: "Claim your deal",
      short: "🎁 Welcome back to Tengasell — {dealCount} new matches in your saved searches. {deepUrl}",
      unsub: true,
    },
    ja: {
      subject: "お帰りを待つ deal があります",
      paragraphs: [
        "しばらくご利用がありません。保存した検索に {dealCount} 件の新しい一致があり、最初の comeback オークションは最低価格なしです。",
        "今週戻ってくるあなたを、特典でお迎えします。",
      ],
      cta: "Dealを受け取る",
      short: "🎁 おかえりなさい — 保存した検索に {dealCount} 件の新着。{deepUrl}",
      unsub: true,
    },
  },
  // ── Gap-8: Best-Offer + saved-search alerts ─────────────────────────────
  "offer.received": {
    en: {
      subject: "New offer on “{auctionTitle}”: {amount}",
      paragraphs: [
        "{bidderLabel} offered {amount} for “{auctionTitle}”.",
        "Offers expire after 48 hours — accept, counter or decline from the item page.",
      ],
      cta: "Review offer",
      short: "🤝 {bidderLabel} offered {amount} for「{auctionTitle}」. Review: {deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」に {amount} のオファー",
      paragraphs: [
        "{bidderLabel} から「{auctionTitle}」に {amount} のオファーが届きました。",
        "オファーの有効期限は48時間です。商品ページで承認・返答・辞退してください。",
      ],
      cta: "オファーを確認",
      short: "🤝 {bidderLabel} が「{auctionTitle}」に {amount} をオファー。確認：{deepUrl}",
    },
  },
  "offer.responded": {
    en: {
      subject: "Your offer on “{auctionTitle}” got a response",
      paragraphs: [
        "The seller {responseLabel} your offer of {amount} on “{auctionTitle}”.",
        "Open the item page to see the details and take the next step.",
      ],
      cta: "View offer",
      short: "📨 {auctionTitle}: オファーが{responseLabel}されました。{deepUrl}",
    },
    ja: {
      subject: "「{auctionTitle}」のオファーに返答がありました",
      paragraphs: [
        "出品者があなたの {amount} のオファーを{responseLabel}しました。",
        "商品ページで詳細を確認して、次のアクションを選んでください。",
      ],
      cta: "オファーを見る",
      short: "📨 {auctionTitle}: あなたのオファーが{responseLabel}に。{deepUrl}",
    },
  },
  "search.alert": {
    en: {
      subject: "New match: “{auctionTitle}”",
      paragraphs: [
        "Your saved search “{searchName}” has a new match: “{auctionTitle}” at {amount}.",
        "Bidding is live now — open the item before it ends.",
      ],
      cta: "Open item",
      short: "🔎 保存検索「{searchName}」の一致：{auctionTitle} {amount}。{deepUrl}",
    },
    ja: {
      subject: "新しい一致：「{auctionTitle}」",
      paragraphs: [
        "保存した検索「{searchName}」に新しい一致があります：「{auctionTitle}」{amount}。",
        "入札は受付中です。終了前に商品ページを開きましょう。",
      ],
      cta: "商品を見る",
      short: "🔎 保存検索「{searchName}」の一致：{auctionTitle} {amount}。{deepUrl}",
    },
  },
  // ── Live Events & First-Party Reminders (R3A) ────────────────────────────
  "auction.event.FollowConfirmed": {
    en: {
      subject: "Reminder set for “{title}”",
      paragraphs: [
        "You are following “{title}” on Tengasell.",
        "First-party in-app reminders (24h, 1h, and live start) are active in your Notifications tray.",
      ],
      cta: "View event",
      short: "🔔 Following “{title}” — in-app start reminders active. {deepUrl}",
    },
    ja: {
      subject: "「{title}」のリマインダーを設定しました",
      paragraphs: [
        "「{title}」をフォローしました。",
        "開始24時間前・1時間前・開始時のアプリ内通知を受け取ります。",
      ],
      cta: "イベントを見る",
      short: "🔔 「{title}」をフォロー中 — アプリ内リマインダー有効。{deepUrl}",
    },
  },
  "auction.event.Starting24h": {
    en: {
      subject: "Starts within 24 hours: “{title}”",
      paragraphs: [
        "“{title}” opens within the next 24 hours ({startsAt}).",
        "Inspect vehicles in the run list and verify buyer qualification ahead of the live floor.",
      ],
      cta: "Open event",
      short: "📅 Starts within 24h: “{title}” ({startsAt}). {deepUrl}",
    },
    ja: {
      subject: "24時間以内に開始：「{title}」",
      paragraphs: [
        "「{title}」は24時間以内に開始します（{startsAt}）。",
        "事前に入札資格と出品リストをご確認ください。",
      ],
      cta: "イベントを開く",
      short: "📅 24時間以内に開始：「{title}」（{startsAt}）。{deepUrl}",
    },
  },
  "auction.event.Starting1h": {
    en: {
      subject: "Starting within 1 hour: “{title}”",
      paragraphs: [
        "“{title}” goes live within 1 hour ({startsAt}).",
        "Join the live auction room early to check synchronization and bidder capacity.",
      ],
      cta: "Enter live room",
      short: "⏰ Starting within 1h: “{title}” ({startsAt}). {deepUrl}",
    },
    ja: {
      subject: "1時間以内に開始：「{title}」",
      paragraphs: [
        "「{title}」は1時間以内にライブ開始します（{startsAt}）。",
        "ライブ会場で事前に入室・資格確認を行ってください。",
      ],
      cta: "ライブ会場へ",
      short: "⏰ 1時間以内に開始：「{title}」（{startsAt}）。{deepUrl}",
    },
  },
  "auction.event.LiveNow": {
    en: {
      subject: "LIVE NOW: “{title}”",
      paragraphs: [
        "“{title}” is live now on Tengasell.",
        "Enter the bidding floor to view the current lot and submit real-time proxy bids.",
      ],
      cta: "Join live room",
      short: "🟢 LIVE NOW: “{title}” — join the bidding floor: {deepUrl}",
    },
    ja: {
      subject: "ライブ配信開始：「{title}」",
      paragraphs: [
        "「{title}」のライブ競りが開始しました。",
        "今すぐ会場に入室してリアルタイム入札に参加してください。",
      ],
      cta: "ライブに参加",
      short: "🟢 ライブ開始：「{title}」— 会場へ：{deepUrl}",
    },
  },
  "auction.lot.UpNext": {
    en: {
      subject: "Up next on the block: “{title}”",
      paragraphs: [
        "Your followed lot “{title}” is queued next on the live floor.",
        "Open the live room so you do not miss opening calls.",
      ],
      cta: "Open live room",
      short: "⏭ Up next: “{title}” on the live floor. {deepUrl}",
    },
    ja: {
      subject: "まもなく開始：「{title}」",
      paragraphs: [
        "フォロー中のロット「{title}」が次に出品されます。",
        "ライブ会場を開いて開始をお待ちください。",
      ],
      cta: "ライブ会場へ",
      short: "⏭ まもなく開始：「{title}」。{deepUrl}",
    },
  },
  "auction.lot.OpenNow": {
    en: {
      subject: "Bidding open now: “{title}”",
      paragraphs: [
        "Your followed lot “{title}” is open for live bidding now.",
        "Submit your maximum proxy bid in the live room before the hammer falls.",
      ],
      cta: "Bid live now",
      short: "🔨 Open now: “{title}” — bidding live! {deepUrl}",
    },
    ja: {
      subject: "入札受付開始：「{title}」",
      paragraphs: [
        "フォロー中のロット「{title}」のライブ入札が開始しました。",
        "ハンマーが落ちる前に上限額を入札してください。",
      ],
      cta: "今すぐ入札",
      short: "🔨 入札開始：「{title}」— ライブ参加：{deepUrl}",
    },
  },
  "auction.live.Outbid": {
    en: {
      subject: "Outbid in live room: “{title}”",
      paragraphs: [
        "Another qualified bidder topped your maximum bid on “{title}” (current {amount}).",
        "Return to the live floor immediately before the 20-second clock closes.",
      ],
      cta: "Raise live bid",
      short: "⚡ Outbid on “{title}” (now {amount}). {deepUrl}",
    },
    ja: {
      subject: "ライブ競りで上回られました：「{title}」",
      paragraphs: [
        "「{title}」で他者の入札が上回りました（現在 {amount}）。",
        "20秒カウントダウン終了前に再入札してください。",
      ],
      cta: "再入札する",
      short: "⚡ 上回られました：「{title}」（現在 {amount}）。{deepUrl}",
    },
  },
  "auction.live.Result": {
    en: {
      subject: "Live lot closed: “{title}”",
      paragraphs: [
        "Live bidding closed on “{title}” ({outcome}).",
        "Open your notifications or order view for settlement details.",
      ],
      cta: "View result",
      short: "🏁 Closed: “{title}” ({outcome}). {deepUrl}",
    },
    ja: {
      subject: "ライブ結果：「{title}」",
      paragraphs: [
        "「{title}」のライブ競りが終了しました（{outcome}）。",
        "詳細・注文状況はアプリ内でご確認ください。",
      ],
      cta: "結果を見る",
      short: "🏁 終了：「{title}」（{outcome}）。{deepUrl}",
    },
  },
};

// ── {param} interpolation ─────────────────────────────────────────────────────

export function interpolate(
  tpl: string,
  params: Record<string, string | number | null | undefined>,
  opts: { html?: boolean } = {},
): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k];
    const s = v == null ? "" : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

// ── Idempotent seeding on boot (upsert by key+channel+locale) ────────────────

function upsertTemplate(
  key: string,
  channel: "email" | "short",
  locale: string,
  fields: { subject: string; body_html: string | null; body_text: string | null; short_text: string },
): void {
  const existing = get<TemplateRow>(
    `SELECT * FROM templates WHERE key = ? AND channel = ? AND locale = ? LIMIT 1`,
    [key, channel, locale],
  );
  const at = nowIso();
  if (existing) {
    if (
      existing.subject === fields.subject &&
      existing.body_html === fields.body_html &&
      existing.body_text === fields.body_text &&
      existing.short_text === fields.short_text
    ) {
      return; // unchanged — leave updated_at alone
    }
    run(
      `UPDATE templates SET subject = ?, body_html = ?, body_text = ?, short_text = ?, active = 1, updated_at = ? WHERE id = ?`,
      [fields.subject, fields.body_html, fields.body_text, fields.short_text, at, existing.id],
    );
    return;
  }
  insert(
    `INSERT INTO templates(key, channel, locale, subject, body_html, body_text, short_text, active, updated_at)
     VALUES(?,?,?,?,?,?,?,1,?)`,
    [key, channel, locale, fields.subject, fields.body_html, fields.body_text, fields.short_text, at],
  );
}

export function seedTemplates(): { rows: number } {
  let rows = 0;
  for (const def of EVENTS) {
    const key = def.key;
    const content = CONTENT[key];
    if (!content) continue; // defensive — EVENTS and CONTENT are kept in lockstep
    for (const locale of ["en", "ja"] as const) {
      const d = content[locale];
      const html = brandEmailHtml(d, locale);
      const text = brandEmailText(d);
      upsertTemplate(key, "email", locale, { subject: d.subject, body_html: html, body_text: text, short_text: d.short });
      upsertTemplate(key, "short", locale, { subject: d.subject, body_html: null, body_text: null, short_text: d.short });
      rows += 2;
    }
  }
  return { rows };
}

// ── Lookup (with en fallback for non-en locales) ──────────────────────────────

export function getTemplate(key: string, channel: "email" | "short", locale: string): TemplateRow | null {
  const direct = get<TemplateRow>(
    `SELECT * FROM templates WHERE key = ? AND channel = ? AND locale = ? AND active = 1 LIMIT 1`,
    [key, channel, locale],
  );
  if (direct) return direct;
  if (locale !== "en") {
    return get<TemplateRow>(
      `SELECT * FROM templates WHERE key = ? AND channel = ? AND locale = 'en' AND active = 1 LIMIT 1`,
      [key, channel],
    );
  }
  return null;
}
