# Task ID: 4-c — Item detail + bidding module

**Agent:** item-module agent (Z.ai Code)

**Task:** Build `src/components/tengasell/pages/item/item-page.tsx` (default export, props `{ id: number }`) — the Yahoo Auctions × eBay hybrid item page with gallery, sticky bid panel, BidSheet (proxy bidding), tabs (description / bid history / Q&A / shipping & payments), similar items, seller feedback, realtime bus updates, terminal banners and 404 handling.

## Files created (all inside `src/components/tengasell/pages/item/` only)

| File | Purpose |
|---|---|
| `item-page.tsx` | Main page: breadcrumb, terminal banner (sold/ended/“You won — pay within 48h”), 55/45 grid, sticky right column (title, meta row, price block + Countdown + ends-at + Extended ×N, reserve indicator, gold Buy-now → `#/checkout/{id}`, teal Place-bid, watch/share/ask row, BidRules, Yahoo-style seller card), tabs wiring, realtime useResource subscriptions, post-deadline 15s sweep, skeleton/error/404 states |
| `gallery.tsx` | aspect-[4/3] main image, prev/next arrows + keyboard (←/→ on carousel group), thumbnail strip (hidden when single image), badge overlays (Featured gold / Ending red / Extended teal / Sold-Ended status), counter `1 / N` |
| `bid-sheet.tsx` | Dialog (desktop) / bottom Sheet (mobile); BidRules grid, $-prefilled max-bid input (minNextBid), `bid.auto` i18n explainer box, potential total incl. shipping, SLA acknowledge note; submit → `api.placeBid` → success toast + subtle success panel + close + refresh; inline error re-renders new minimum; outbid-by-auto-bid keeps sheet open; signed-out → “Sign in to bid” → `#/signin`; own auction → disabled note |
| `qa-section.tsx` | Q&A tab: ask form (min 10 chars, counter, toasts), seller inline answer forms, Q/A pairs with masked askers + relative times; refreshes via `question:update` |
| `bid-history.tsx` | Yahoo 入札履歴 table: masked bidder (`si***a` via maskUsername), Zap auto-bid marker, winning=teal / outbid chips, `(you)` highlight, relative time, max-h-96 `ts-scrollbar`, sticky header |
| `shipping-payments.tsx` | shippingLabel + pickup note, payments chips (EcoCash/Visa/Mastercard/PayPal/ZIPIT/COD), Buyer Protection SLA panel (48h/3d/7d/funds-held/5d refunds from `SLA` const) |
| `similar-items.tsx` | `api.auctions({category, limit:7, order:"hot"})` minus current → 6 AuctionCards in 2/3-col grid |
| `seller-feedback.tsx` | `#seller-feedback` anchor section for seller-card “View feedback” scroll (scroll-mt-28), ratings list w/ RatingStars + direction chips |
| `helpers.ts` | `maskUsername` (Yahoo-style “si***a”) |

## Contract compliance
- Props `{ id: number }`, default export; `'use client'` everywhere; no files touched outside the item folder.
- `useResource` with `auction:update` / `auction:ended` / `question:update` / `order:update` events; “won by me” detected from `api.orders("buying")` filtered by `auction_id`.
- Bid sheet syncs its prefill to the new minimum whenever the auction prop refreshes (outbid case).
- 44px touch targets (min-h-11/min-h-12), a11y roles/labels/aria-live, reduced-motion respected, formatUSD/formatDateTime/formatRelative/compactNumber/conditionLabel/shippingLabel from format.ts, i18n keys used (`bid.auto`, `action.*`, `bid.*`).
- Deliberately avoided `Countdown`’s `onEnd` prop (fires on every render once expired — would loop with auto-reload); used a guarded 15s interval instead.

## Verification
- `bunx tsc --noEmit` — no errors in item module.
- `bun run lint` — zero errors/warnings from item files (remaining project errors are pre-existing in app-shell/browse/sell/ui.tsx, owned by other agents).
- `curl http://localhost:3000/` → **200**.
- Headless-browser smoke test: `#/item/1026` renders breadcrumb/gallery/tabs/right panel/similar items/seller card; BidSheet opens as Dialog with “Sign in to bid” prompt when signed out, and with the bid form (prefilled min next bid **US$435** = 433 + $2 increment) when signed in as `simba`; watch state showed “Watching”. No page errors.

## Notes for downstream agents
- Buy-now renders only when `buy_now_price != null && bid_count === 0 && status === "live"` and navigates to `#/checkout/{id}` — checkout-page agent should handle that route.
- “Ask seller” links to `#/messages` (no per-auction thread deep link).
- The seller card pulls `response_minutes`/`sales`/`joined_at` from `api.profile(seller_username)`.
