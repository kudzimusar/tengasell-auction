# Task 6-b — Paynow payment system (Z.ai Code)

Task: Paynow (paynow.co.zw) Web Payments integration for Tengasell — real API
client + fully functional mock/sandbox mode when env credentials are absent.

## Files created / modified (nothing outside the task's file list + the shared
paynow-order.ts helper in src/lib/server/)

**Server libs (src/lib/server/)**
- `paynow.ts` — Paynow Web Payments client: `paynowHash(values, key)`
  (concat → encodeURIComponent → append key → MD5 uppercase),
  `initiateTransaction()` (POST form-urlencoded to
  https://www.paynow.co.zw/interface/initiatetransaction with id, reference,
  amount, additionalinfo, returnurl, resulturl, authemail, status:"Message",
  optional method+phone; response hash VERIFIED), `pollStatus(pollUrl)` (GET →
  url-encoded status: paid/awaiting delivery/cancelled/cancelled by user/
  disputed/failed), `validateCallback(fields, key)` (resulturl webhook),
  `isMockMode()` (true when PAYNOW_INTEGRATION_ID/KEY absent), mock adapter
  with identical response shapes (redirecturl → `#/pay/{reference}`, signed
  with MOCK_INTEGRATION_KEY, zero network calls).
- `trailbase-admin.ts` — mirrors trade engine's tbLogin: POST
  /api/auth/v1/login (ADMIN_USERNAME/ADMIN_PASSWORD env, default
  admin/Tengasell#2025) → cached auth_token (24h TTL, 401-retry). Exports
  `tbFetch` + `tbGet`/`tbList`/`tbCreate`/`tbPatch`/`nowIso`.
- `paynow-order.ts` — shared glue for the routes: `resolveUserFromToken`
  (verifies buyer token via /api/auth/v1/status + JWT username),
  `fetchOrderWithUserToken` (order fetched WITH the buyer's token — ACL hit
  proves party access), session row load/patch, `settlePaidOrder()` which
  MIRRORS the trade engine's `order:pay` exactly (order → paid + paid_at;
  payments row method `paynow-{channel}` status settled reference TS-ORDR…;
  seller "Payment received … Dispatch within 3 days (SLA)" notification;
  order:pay audit event) — idempotent (no-op when the order already left
  pending_payment, dedupe on reference). `makeReference` = `TS-ORDR{id}-{Date.now()}`,
  `sandboxRedirectUrl` (display hints as query params — the page re-verifies
  via poll so they cannot spoof state), `paynowUrls` (PAYNOW_RETURN_URL /
  PAYNOW_RESULT_URL env or origin-derived).

**TrailBase**
- `migrations/main/U1000000004__paynow.sql` — paynow_sessions (STRICT,
  INTEGER PK AUTOINCREMENT, order_id, reference UNIQUE, amount, method,
  phone, status default 'pending', poll_url, redirect_url, paynow_hash,
  error, created_at, updated_at) + 2 indexes. APPLIED to the live DB
  (verified 200 + rows via admin curl across many separate bash calls).
- `config.textproto` — paynow_sessions record API registered next to
  payments: acl_authenticated [CREATE, READ, UPDATE], read for order
  parties, create/update admin-only (bids pattern).
- `mini-services/trailbase-db/restart-trailbase.py` — double-fork daemon
  restart helper (setsid → survives sandbox call-tree reaping; trail now
  runs with PPid 1, verified persistent).

**Next API routes (src/app/api/paynow/)**
- `initiate/route.ts` — POST {orderId, method ecocash|innbucks|card,
  phone?} + Bearer buyer token. Validates body (Zimbabwe mobile regex
  `^(?:0|\+263)7\d{8}$` for mobile money), loads order WITH the user token,
  checks buyer_username === token user + status pending_payment, calls
  initiate (mock or real), inserts paynow_sessions row (admin token),
  responds {ok, reference, redirectUrl, pollUrl, mock, mode, orderId}.
- `poll/route.ts` — POST {reference} → {ok, status, amount, method, phone,
  orderId, title, payBy, order?}; live mode refreshes from Paynow's pollurl
  and settles idempotently once paid; order returned fresh via admin.
- `sandbox/route.ts` — MOCK ONLY (403 + {ok:false,error:"Sandbox disabled"}
  with real creds). approve → session paid + settlePaidOrder (engine-mirror);
  decline → session cancelled; already-decided sessions return idempotently.
- `callback/route.ts` — production resulturl webhook: raw text → ordered
  form parse → validateCallback with PAYNOW_INTEGRATION_KEY → session
  lookup → status map (paid/awaiting delivery/delivered/sent → paid;
  cancelled/failed → cancelled) → settle → plain text "OK". 503 when no
  credentials configured (sandbox build).

**Frontend**
- `pages/pay/paynow-sandbox.tsx` (#/pay/{reference}) — neutral hosted-gateway
  card: "Paynow" wordmark + Sandbox chip, teal/gold tokens, merchant
  Tengasell, amount, reference, item, method + masked phone (••• ••• 4567).
  Polls /api/paynow/poll on mount + every 2.5s while pending (approvals in
  another tab picked up too). Mobile-money pending state = pulsing
  phone-push animation (framer-motion, useReducedMotion-gated). Approve →
  gold spring check → bus.emit("order:update", {order}) → toast → navigate
  #/orders/{orderId} after 1.2s. Decline → cancelled card → toast → back to
  order after 1.4s. notFound (404) + error (retry) + loading states; i18n
  EN/JA; "Back to order" link throughout.
- `tengasell-app.tsx` — ONE case added: "pay" → lazy PaynowSandboxPage with
  segments[1] as reference (nothing else touched in that file).
- `payment-methods.tsx` — "Paynow — EcoCash · InnBucks · Visa" method first
  (sub "Zimbabwe's secure payment gateway"); channel radios (EcoCash/
  InnBucks/Visa-Mastercard); mobile channels → phone input with
  07XXXXXXXX / +263XXXXXXXXX validation; card channel → "Card details are
  entered on Paynow's secure page" note (no fields). `startPaynowPayment()`
  posts /api/paynow/initiate with the TrailBase Bearer token read from the
  same `ts_auth` localStorage slot remote.ts uses.
- `checkout-page.tsx` — Paynow default method; after api.buyNow → initiate →
  navigate to redirectUrl (#/pay/{ref} hash-nav; http URLs via
  window.location.assign for production). Initiate failure → order stays
  pending_payment with a reserved-with-warning success screen + toast
  ("pay from Orders within 48h" — recoverable). Non-paynow methods unchanged.
- `order-dialogs.tsx` — PaymentDialog gets the Paynow option → same
  initiate → closes dialog and navigates to the sandbox page; inline error
  on failure; "Continue to Paynow · US$X" submit label.
- `i18n.tsx` — paynow.* + sandbox.* keys, EN and JA (verified rendering in
  both locales).
- `developers-page.tsx` — "Payments — Paynow" section: endpoint table,
  hash-algorithm + sandbox-vs-production (all four env vars) code blocks,
  curl example, in-page anchor via the existing SECTIONS scroll-button
  pattern (hash-router safe).
- `help-page.tsx` — Paynow row first in the payments section.

## Verification evidence

- `bun run lint` → 0 findings project-wide; `bunx tsc --noEmit` → only the
  3 pre-existing gen-sql.ts/skills errors.
- paynow_sessions LIVE in TrailBase (admin curl 200; rows persisted across
  dozens of separate bash calls; trail process PPid 1, detached daemon).
- Hash unit properties verified (concat order, encodeURIComponent, MD5
  upper; tamper detection; mock adapter response hash round-trip).
- Curl API tests: bad phone → 400; initiate → {ok, mock:true,
  redirectUrl:"#/pay/…"}; poll pending; sandbox decline → cancelled + order
  untouched; callback in mock mode → 503.
- LIVE E2E through the gateway (agent-browser on http://localhost:81/):
  1. rufaro sell wizard → listing #2011 "Braai Master 3-Burner Gas Grill"
     buy-now US$120 (+US$8 shipping) → live.
  2. sign out → simba → #/item/2011 → Buy now → checkout → Paynow/EcoCash
     → 0771234567 → "Confirm & reserve · US$128" → landed on
     #/pay/TS-ORDR25-… → "Approve payment (simulated push)" → redirected
     #/orders/25 showing Paid timeline with "paynow-ecocash · US$120" +
     TS-ORDR reference.
  3. TrailBase admin: ORDER 25 status=paid paid_at set; PAYMENT row
     paynow-ecocash 120.0 settled TS-ORDR25-…; SESSION row paid ecocash
     0771234567; AUDIT order:pay …{"gateway":"paynow"}; seller NOTIFICATION
     "Payment received … Dispatch within 3 days (SLA)".
  4. PaymentDialog path: pending order #23 → "Pay US$28 now" → Paynow/
     InnBucks +263781234567 → "Continue to Paynow · US$28" → sandbox →
     approve → #/orders/23 paid; DB: paynow-innbucks settled, session paid.
  5. Decline path (fresh listing #2012 → order 26): Decline → cancelled
     card + toast → back to #/orders/26; ORDER 26 still pending_payment
     (recoverable), session cancelled.
- Mobile 390×844: sandbox page `<main>` exactly 0–390 with ZERO overflowing
  children; documentElement.scrollWidth 399 identical on #/ home — the 9px
  is the pre-existing app-shell header account block (untouchable, same
  finding as agents 4-a/5-a/6-a). Screenshots:
  screenshots/6b-sandbox-mobile-390-pending.png + …-cancelled.png.
- Developers #payments section + help #payments Paynow row verified
  rendering (EN + JA), scroll-anchor button works; no console/page errors;
  dev.log clean (all /api/paynow/* 200s).

## Production switch

Set env vars on the Next server process and restart it:
```
PAYNOW_INTEGRATION_ID=…   # paynow.co.zw merchant dashboard
PAYNOW_INTEGRATION_KEY=…  # server-side only
PAYNOW_RETURN_URL=https://<host>/   # buyer return (defaults to origin + #/orders/{id})
PAYNOW_RESULT_URL=https://<host>/api/paynow/callback  # webhook (defaults to origin + /api/paynow/callback)
```
`isMockMode()` flips false automatically: initiate hits the real gateway
(response hash verified), redirectUrl becomes Paynow's hosted checkout
(browserurl/redirecturl), the poll route polls Paynow's pollurl and settles
on "paid"/"awaiting delivery", the callback webhook becomes active
(validateCallback + plain "OK"), and /api/paynow/sandbox returns
403 {ok:false,error:"Sandbox disabled"}. ADMIN_USERNAME/ADMIN_PASSWORD env
override the TrailBase admin login used for session writes (defaults
admin/Tengasell#2025).
