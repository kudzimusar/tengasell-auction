# Secrets & integrations — what the live site needs

Status of **https://tengasell-zw.fly.dev** as of 2026-10-21.

Legend: ✅ set and verified · ⚠️ required before public launch · ⏳ optional / later

---

## 1. Application secrets — generated and deployed ✅

These were created with `openssl rand`, stored in a 0600 local vault
(`~/.tengasell/secrets.env`), and pushed to Fly as encrypted secrets
(`fly secrets set`, readable only inside the machine).

| Variable | Purpose | Status |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | Signs NextAuth sessions | ✅ generated, set |
| `PLATFORM_JWT_SECRET` | Platform API tokens | ✅ generated, set |
| `TGS_INTERNAL_SECRET` | Service-to-service signing | ✅ generated, set |
| `TGS_INTERNAL_TOKEN` | Service-to-service bearer | ✅ generated, set |
| `ADMIN_PASSWORD` | Staff/admin login + trade-engine auth | ✅ rotated (old public value now returns 401) |
| `ADMIN_USERNAME` | Staff username | ✅ `admin` |

**Rotated:** the previously published `Tengasell#2025` no longer works for `admin`. The new
password is in the vault and in Fly secrets. Trade engine picks it up from `ADMIN_PASSWORD`.

> ⚠️ The **other seeded demo accounts** (nyasha, rufaro, chipo, tendai …) still use the old
> public password. Rotate or delete them before opening the site to strangers.

---

## 2. Payments — Paynow (Zimbabwe) ⚠️ the critical one

Without these, checkout runs in **mock mode**: orders are created, but no money moves.

| Variable | Where it comes from |
| --- | --- |
| `PAYNOW_INTEGRATION_ID` | Paynow merchant dashboard → *Integrations* |
| `PAYNOW_INTEGRATION_KEY` | same screen (secret) |
| `PAYNOW_RESULT_URL` | `https://tengasell-zw.fly.dev/api/paynow/callback` |
| `PAYNOW_RETURN_URL` | `https://tengasell-zw.fly.dev/#/orders` |

How to get them:

1. Register a merchant account at **https://paynow.co.zw** (Zimbabwean company registration,
   bank account, director ID — KYC is manual, typically 1–3 business days).
2. Create an integration (Web / E-commerce) in the dashboard.
3. Copy the Integration ID and Integration Key into the app.
4. Set both URLs above, then test with Paynow's sandbox before going live.

**I cannot create these for you** — they are issued against your company's KYC, and the key is
shown once in your merchant dashboard. Send me the two values (or add them yourself) and I will
deploy them and run a sandbox transaction.

Cost: Paynow charges a transaction commission (typically ~2–3%), no fixed monthly fee.

---

## 3. Email — transactional mail ⏳

| Variable | Provider | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | https://resend.com | Free tier 3,000 emails/mo, 100/day |
| `EMAIL_FROM` | your domain | Requires SPF/DKIM DNS records on `tengasell.com` |

Without it, `EmailOutbox` rows queue but nothing is delivered (the app logs
"Falling back to local sendmail"). Any SMTP provider works if you prefer Postmark/SES.

---

## 4. Messaging channels ⏳ (needed for outbid / order notifications)

| Variable | Where | Requirement |
| --- | --- | --- |
| `WHATSAPP_TOKEN` | Meta Business → WhatsApp Cloud API | Permanent token via System User |
| `WHATSAPP_PHONE_ID` | same | Phone number ID |
| `WHATSAPP_APP_SECRET` | same | Webhook signature verification |
| `MESSENGER_PAGE_TOKEN` | Meta → Messenger | Facebook Page + app review |
| `GRAPH_API_VERSION` | — | default `v20.0` |
| `TELEGRAM_BOT_TOKEN` | https://t.me/BotFather | `/newbot`, instant, free |

WhatsApp requires **business verification** with Meta (company documents) and a dedicated phone
number; approval takes days. Telegram takes two minutes and is the pragmatic first channel.

---

## 5. Maps / GIS ⏳

| Variable | Purpose | Notes |
| --- | --- | --- |
| `OSM_UPSTREAM` | tile source for the GIS service | default OpenStreetMap |
| `GIS_BASE_URL` | internal service URL | already wired to `:3004` |

Public OSM tiles are fine for testing; their usage policy forbids production-scale traffic.
For real volume use MapTiler (free 100k tiles/mo) or self-host tiles.

---

## 6. MCP & agent integrations ✅ built in

**There is no MCP key to buy.** Trailbase ships the MCP server:

```bash
trail mcp http://localhost:3001 --tokens=$(trail --depot=/data/traildepot user mint my_agent)
```

- `trail user mint <user>` produces an auth/refresh token pair for a user or agent.
- The MCP surface exposes the same record APIs the app uses (`auctions`, `bids`, `orders`, …).
- Agent traffic is audited in `audit_events` with `source = 'mcp'`.
- Mint tokens per agent — never share the admin token with an external agent.

The in-app **Developers** page documents the REST/socket/MCP contract and shows live status.

---

## 7. Optional hardening / observability ⏳

| Item | Why | Cost |
| --- | --- | --- |
| Error tracking (Sentry) | catches runtime failures in production | free tier |
| Uptime monitor (BetterStack / UptimeRobot) | alerts when the machine sleeps or dies | free tier |
| Cloudflare in front | DNS, TLS, bot filtering, caching | free |
| Off-site database backup | volume snapshots exist, but copies matter | Fly snapshots included |

---

## 8. What is already working without any third-party key

- Marketplace browsing, search, categories, item pages
- Auction countdowns, bids and proxy bidding (trade engine, `:3002`)
- Live auction rooms, best-offer endpoints (tables present, no rows yet)
- Messaging threads, watchlist, saved searches
- Staff console, trust/finance/govern services (internal)
- Auth, MFA state machine, session handling
- Public status page, smoke/health endpoints

---

## 9. Where the values live

| Store | Contents | Access |
| --- | --- | --- |
| `~/.tengasell/secrets.env` (mode 600) | every generated secret + empty slots for providers | this Mac only |
| Fly secrets (`fly secrets list`) | the five app secrets, encrypted at rest | machine runtime only |
| `deploy/seed/trailbase-main.db` | admin password **hash** (rotated), not the plaintext | repo |

**Do not put these in Google Keep.** A notes app syncs to every device, has no access log, no
rotation, and is the first place an attacker looks after an email compromise. Use 1Password
(the 1Password CLI is installed on this machine), Fly secrets, or at minimum an encrypted file
you control. If you want, I can load everything into 1Password with `op` and delete the local file.

---

## 10. Order of work to go fully live

1. **Paynow merchant account** → integration id + key → I deploy and run a sandbox payment.
2. **Rotate or delete the demo accounts** (old public password).
3. **Email domain verification** (Resend) so order/bid emails actually leave the building.
4. **Telegram bot** (2 minutes) for outbid alerts while WhatsApp is under review.
5. Add Sentry + uptime monitoring, then a real backup routine.
6. Legal pages already exist in-app (ToS, privacy, refunds) — have them reviewed for Zimbabwe.
