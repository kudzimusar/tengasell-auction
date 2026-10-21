import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { audit } from "@/lib/server/api"

export const runtime = "nodejs"

// One-click unsubscribe (MSG-007 / PRV-003). No auth — token is the capability.
// Returns a standalone HTML page (not JSON).

function htmlPage(opts: { title: string; titleJa: string; bodyEn: string; bodyJa: string; emailLine?: string }) {
  const masked = opts.emailLine ? `<p style="margin:6px 0 0;color:#5b7278;font-size:14px;word-break:break-all;">${opts.emailLine}</p>` : ""
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tengasell — Unsubscribe</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; background: #f2f6f7; color: #142326; min-height: 100vh; display: flex; flex-direction: column; }
  .banner { background: linear-gradient(135deg, #1a7a8a 0%, #145e6b 100%); color: #fff; padding: 20px 16px; text-align: center; }
  .banner .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
  .banner .logo .gold { color: #e5b93b; }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .card { background: #fff; border-radius: 16px; border: 1px solid #d8e4e6; box-shadow: 0 8px 24px rgba(20, 62, 71, .08); padding: 32px 24px; max-width: 440px; width: 100%; text-align: center; }
  .icon { font-size: 44px; margin-bottom: 8px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #14525c; }
  p.ja { color: #5b7278; font-size: 14px; margin: 0 0 14px; }
  p.en { color: #2c3f44; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
  a.btn { display: inline-block; min-height: 44px; padding: 12px 22px; background: #1a7a8a; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; }
  a.btn:hover { background: #145e6b; }
  footer { text-align: center; color: #7a9196; font-size: 12px; padding: 16px; }
</style>
</head>
<body>
  <div class="banner"><div class="logo">Tenga<span class="gold">Sell</span></div></div>
  <main>
    <div class="card">
      <div class="icon" aria-hidden>✅</div>
      <h1>${opts.title}</h1>
      <p class="ja">${opts.titleJa}</p>
      <p class="en">${opts.bodyEn}<br />${opts.bodyJa}</p>
      ${masked}
      <p style="margin:20px 0 0"><a class="btn" href="/">Continue to Tengasell · Tengasellへ</a></p>
    </div>
  </main>
  <footer>© Tengasell (Pvt) Ltd · Harare, Zimbabwe · Marketing emails only — transactional notices always sent</footer>
</body>
</html>`
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@")
  if (!domain) return email
  const m = name.length <= 2 ? name : `${name.slice(0, 2)}${"•".repeat(Math.min(name.length - 2, 5))}`
  return `${m}@${domain}`
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || ""
  if (!token) {
    return htmlPage({
      title: "Unsubscribe link required",
      titleJa: "配信停止リンクが必要です",
      bodyEn: "This unsubscribe link is missing its token. Open the link directly from a Tengasell message, or turn off marketing messages in your account's communication preferences.",
      bodyJa: "配信停止リンクにトークンがありません。Tengasellのメッセージのリンクから開くか、アカウントの通知設定でマーケティング配信をオフにしてください。",
    })
  }

  // ── TUCS L1: channel-account token (Telegram/WhatsApp/SMS/Social) ──
  const channelAccount = await db.channelAccount.findUnique({ where: { unsubToken: token } })
  if (channelAccount) {
    const owner = await db.user.findUnique({ where: { id: channelAccount.userId } })
    if (channelAccount.status === "LINKED") {
      await db.channelAccount.update({
        where: { id: channelAccount.id },
        data: { marketingOptIn: false, doubleOptInAt: null },
      })
      if (owner) {
        const pref = await db.notificationPref.findFirst({ where: { userId: owner.id, channel: channelAccount.channel, event: "MARKETING" } })
        if (pref) {
          if (pref.enabled) await db.notificationPref.update({ where: { id: pref.id }, data: { enabled: false } })
        } else {
          await db.notificationPref.create({ data: { userId: owner.id, channel: channelAccount.channel, event: "MARKETING", enabled: false } })
        }
        await audit({
          actorId: owner.id, actorRole: owner.role, action: "comms.unsubscribe.channel",
          targetType: "USER", targetId: owner.id,
          before: JSON.stringify({ channel: channelAccount.channel, handle: channelAccount.handle, marketingOptIn: true }),
          after: JSON.stringify({ channel: channelAccount.channel, handle: channelAccount.handle, marketingOptIn: false }),
          reason: "UNSUBSCRIBE_LINK",
        })
      }
    }
    return htmlPage({
      title: "You're unsubscribed",
      titleJa: "配信を停止しました",
      bodyEn: `You won't receive marketing messages on ${channelAccount.channel} anymore. Transactional messages (orders, bids, account notices) are always sent.`,
      bodyJa: `${channelAccount.channel}でのマーケティング配信を停止しました。取引通知（注文・入札・アカウント）は引き続き届きます。`,
      emailLine: channelAccount.handle ? `${esc(maskEmail(channelAccount.handle))} · このチャネルに適用されました` : "",
    })
  }

  const suppression = await db.suppression.findUnique({ where: { token } })
  if (!suppression) {
    return htmlPage({
      title: "You're already unsubscribed",
      titleJa: "配信は停止されています",
      bodyEn: "This link is no longer active — you won't receive marketing emails from Tengasell. Transactional messages (orders, bids, account notices) are always sent.",
      bodyJa: "このリンクは無効です — Tengasellからマーケティングメールは届きません。取引通知（注文・入札・アカウント）は引き続き届きます。",
    })
  }
  // The token was CLICKED → this row becomes ACTIVE suppression (queue-time rows stay pending otherwise)
  if (suppression.reason === "UNSUB_TOKEN") {
    await db.suppression.update({ where: { id: suppression.id }, data: { reason: "UNSUBSCRIBED" } }).catch(() => undefined)
  }
  // Resolve the user (suppression.userId, or by email)
  const user = suppression.userId
    ? await db.user.findUnique({ where: { id: suppression.userId } })
    : await db.user.findUnique({ where: { email: suppression.email } })
  if (user) {
    for (const ch of ["EMAIL", "INAPP"] as const) {
      const existing = await db.notificationPref.findFirst({ where: { userId: user.id, channel: ch, event: "MARKETING" } })
      if (existing) {
        if (existing.enabled) await db.notificationPref.update({ where: { id: existing.id }, data: { enabled: false } })
      } else {
        await db.notificationPref.create({ data: { userId: user.id, channel: ch, event: "MARKETING", enabled: false } })
      }
    }
    const consent = await db.consentRecord.findFirst({ where: { userId: user.id, purpose: "MARKETING" } })
    if (consent) {
      if (consent.granted || !consent.withdrawnAt) {
        await db.consentRecord.update({
          where: { id: consent.id },
          data: { granted: false, withdrawnAt: new Date(), evidence: `unsub_token:${token}` },
        })
      }
    } else {
      await db.consentRecord.create({
        data: { userId: user.id, purpose: "MARKETING", granted: false, source: "unsubscribe_link", withdrawnAt: new Date(), evidence: `unsub_token:${token}` },
      })
    }
    await audit({
      actorId: user.id, actorRole: user.role, action: "comms.unsubscribe",
      targetType: "USER", targetId: user.id, reason: "UNSUBSCRIBE_LINK",
    })
  }
  return htmlPage({
    title: "You're unsubscribed",
    titleJa: "配信を停止しました",
    bodyEn: "You won't receive marketing emails from Tengasell anymore. Transactional messages (orders, bids, account notices) are always sent.",
    bodyJa: "Tengasellからのマーケティングメールを停止しました。取引通知（注文・入札・アカウント）は引き続き届きます。",
    emailLine: user ? `${esc(maskEmail(user.email))} · このメールアドレスに適用されました` : "",
  })
}
