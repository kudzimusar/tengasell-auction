# Paynow (Zimbabwe) — Integration Runbook

Tengasell takes buyer payments through **Paynow Zimbabwe** (`paynow.co.zw`) —
EcoCash, InnBucks (mobile-money pushes) and Visa / Mastercard (hosted card
checkout). This document is the single source of truth for how the
integration works, how to configure it, and how to go live.

---

## 1. Architecture

```
Buyer (PWA)                      Next.js BFF                       Paynow             TrailBase
    │                                │                               │                   │
    │ 1. POST /api/paynow/initiate   │                               │                   │
    │   { orderId, method, phone }   │── 2. initiateTransaction ───▶ │                   │
    │◀─ 3. redirectUrl, reference ──│      (signed form POST)       │──▶ hash-verified  │
    │                                │                               │    response       │
    │ 4. window.location → redirect  │                               │                   │
    │    (sandbox page in mock mode,  │                               │                   │
    │     paynow.co.zw in live mode)  │                               │                   │
    │                                │                               │                   │
    │        ┌──────────── payment happens on Paynow / buyer phone ──┼───────────────────┤
    │        │                       │                               │                   │
    │        │                       │◀ 5. resulturl webhook ──────── │                   │
    │        │                       │   POST /api/paynow/callback   │   (hash-verified) │
    │        │                       │   → settle order ──────────────────────────────▶ │
    │ 6. browser returns to RETURN   │                               │                   │
    │    URL (#/orders/{id})         │                               │                   │
    │ 7. order page polls every 4s ─│ POST /api/paynow/poll         │                   │
    │    ← paid → toast + reload ───│  { orderId } → settle if paid │── pollurl GET ▶  │
    │                                │                               │                   │
    │                                │ 8. sweep (60s, live only)     │                   │
    │                                │    paynow-reconcile.ts polls  │                   │
    │                                │    stale pending sessions ──▶│  (webhook backup) │
```

**Files**

| File | Role |
| --- | --- |
| `src/lib/server/paynow.ts` | Paynow Web Payments client — `initiateTransaction`, `pollStatus`, `validateCallback` (MD5 hash), and the mock/sandbox adapter |
| `src/lib/server/paynow-order.ts` | Order glue — session rows, buyer auth, settlement that mirrors the trade engine's `order:pay` (orders row → paid, payments row, seller notification, audit event, finance `order.paid`) |
| `src/lib/server/paynow-reconcile.ts` | 60s reconciliation sweep — polls pending sessions on Paynow so a payment completes even when the webhook is dropped |
| `src/app/api/paynow/initiate/route.ts` | Buyer-authenticated session opener (order ownership re-verified with the buyer's token) |
| `src/app/api/paynow/poll/route.ts` | Status by merchant `reference` **or by `orderId`** (return-page poll loop) |
| `src/app/api/paynow/callback/route.ts` | `resulturl` webhook — hash-verified, answers plain `OK`, settles paid |
| `src/app/api/paynow/sandbox/route.ts` | Mock-mode approve/decline (403 when live credentials are set) |
| `src/components/tengasell/pages/pay/paynow-sandbox.tsx` | Hosted sandbox checkout page (`#/pay/{reference}`) for mock mode |
| `src/components/tengasell/pages/orders/paynow-return.tsx` | Return-page poll hook + status banner |

**Completion guarantees (defense in depth)** — a paid buyer always gets
their order settled, in this order:

1. **Webhook** — Paynow POSTs the `resulturl` (primary path; hash-verified).
2. **Return-page poll** — the buyer's browser polls `/api/paynow/poll`
   `{ orderId}` every 4s while the order is `pending_payment`.
3. **Reconciliation sweep** — every 60s the BFF re-polls pending sessions
   older than 120s directly on Paynow (`paynow-reconcile.ts`, started from
   `src/instrumentation.ts`).
4. **Finance backfill** — the finance service's own 60s sweep funds escrow
   for any paid order the events missed.

All settlement paths are **idempotent**: the order-status guard, the
payments-row reference de-duplication, and an in-process settle lock keep
concurrent webhook/poll/sweep calls from double-writing.

---

## 2. Modes

| | **Mock / sandbox** | **Live** |
| --- | --- | --- |
| Active when | `PAYNOW_INTEGRATION_ID` or `PAYNOW_INTEGRATION_KEY` unset | both set |
| Checkout | hosted sandbox page `#/pay/{reference}` (approve / decline buttons) | Paynow hosted checkout (EcoCash push, InnBucks push, card) |
| Settlement | `/api/paynow/sandbox` route | webhook + poll + sweep |
| `initiate` response `mode` | `"sandbox"` | `"live"` |

The mock adapter reproduces the real response shapes exactly (url-encoded
forms, hash-signed) so the wiring that runs in sandbox is the wiring that
runs in production — only the endpoint differs.

---

## 3. Getting to live mode

1. **Merchant account** — register at <https://www.paynow.co.zw>
   (business details + bank/settlement account). Approval is manual;
   Paynow support (`support@paynow.co.zw`) responds within days.
2. **Integration credentials** — in the Paynow merchant admin create an
   integration of type **Web Payments**. Copy the **Integration ID** and
   **Integration Key**.
3. **Environment** (Fly secrets for production):

   ```bash
   fly secrets set \
     PAYNOW_INTEGRATION_ID=… \
     PAYNOW_INTEGRATION_KEY=… \
     PAYNOW_RETURN_URL=https://tengasell-zw.fly.dev \
     PAYNOW_RESULT_URL=https://tengasell-zw.fly.dev/api/paynow/callback
   ```

   * `PAYNOW_RETURN_URL` — where the buyer's browser lands after paying.
     Defaults to `{origin}/#/orders/{id}` per order.
   * `PAYNOW_RESULT_URL` — the webhook. Must be publicly reachable and
     answer `200 OK` (exact body `OK`) or Paynow will retry.
   * The integration key is the **only** signing secret — treat it like a
     password (never in the repo, see `docs/SECRETS.md`).
4. **Verify** —
   `curl -X POST https://…/api/paynow/initiate` with a real buyer order, or
   simply pay a US$1 test listing end-to-end and watch:
   - `paynow_sessions` row → status `paid`
   - `orders` row → status `paid`, `paid_at` set
   - `payments` row with method `paynow-{channel}` and the `TS-ORDR…` reference
   - `audit_events` row `order:pay` (source `web`)
   - finance: escrow funded for the order
   - buyer's return page flipped to *Paid* without a manual reload

---

## 4. Protocol details (why the code looks like it does)

- **Hash algorithm** — `MD5( encodeURIComponent( concat(values in order) )
  + integrationKey )`, hex uppercase. Field order matters, which is why
  callback bodies are parsed as ordered forms, never as JSON.
- **Initiate** — POST `application/x-www-form-urlencoded` to
  `https://www.paynow.co.zw/interface/initiatetransaction` with `id`,
  `reference`, `amount` (2dp), `additionalinfo`, `returnurl`, `resulturl`,
  `authemail`, `status: "Message"`, optional `method` + `phone` for
  mobile-money pushes. The **response hash is verified** before anything
  is trusted.
- **Merchant references** — `TS-ORDR{orderId}-{epochMs}` (validated by
  regex; unique per attempt, which is what makes payments rows safely
  de-duplicatable).
- **Statuses** — Paynow speaks `paid` / `awaiting delivery` (settled),
  `cancelled` / `cancelled by user`, `failed`, `disputed`, `refunded`.
  Tengasell maps these onto session statuses `paid` / `cancelled` /
  `failed` / `disputed`; a session that is already **paid is never
  downgraded** by a late repeat webhook. Post-payment disputes surface on
  the session (support path, finance console handles refunds/chargebacks).
- **Webhook response** — plain text `OK` with HTTP 200. Anything else and
  Paynow keeps retrying.

---

## 5. Operations

- **Watch** `paynow_sessions`: `pending` older than a few minutes with a
  live `poll_url` should self-resolve within 60s (the sweep) — if it does
  not, check Paynow's status page and the sweep logs (`paynow-sweep`).
- **Audit trail** — `order:pay` (settlement, buyer user), `paynow:callback`
  (webhook transitions), `paynow:reconcile` (sweep transitions). Repeat
  deliveries that change nothing write nothing.
- **Finance reconciliation** — the admin console reconciliation run flags
  `payment_without_escrow` / `paid_order_without_escrow` exceptions; any
  Paynow-paid order stuck there self-heals on the next finance sweep.
- **Disputed sessions** — do not alter the order; handle through the
  support/refund flow (trust → finance consoles).

---

## 6. Go-live checklist

- [ ] Paynow merchant account approved; Integration ID + Key obtained
- [ ] `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` set (Fly secrets)
- [ ] `PAYNOW_RETURN_URL` / `PAYNOW_RESULT_URL` point at the public origin
- [ ] Webhook verified: a real US$1 payment settles end-to-end (order →
      payments → notification → finance escrow → receipts)
- [ ] Buyer return page flips to *Paid* without manual reload
- [ ] Webhook-drop drill: pay with `PAYNOW_RESULT_URL` temporarily blocked
      → return-page poll **or** the 60s sweep settles the order
- [ ] Refund path exercised once via the finance console (credit note +
      ledger stays balanced)
- [ ] ZIMRA: Paynow transaction reports exported for the VAT pack
