# Google Play — store listing copy

## Basics

| Field | Value |
| --- | --- |
| App name (≤30) | `TengaSell — Zimbabwe Auctions` |
| Short description (≤80) | `Bid, buy and sell in Zimbabwe. Live auctions, USD, buyer protection.` |
| Category | Shopping |
| Tags | Auctions, Marketplace, Zimbabwe |
| Contact email | support@tengasell.com |
| Website | https://tengasell.com |
| Privacy policy | https://tengasell-zw.fly.dev/#/policies/privacy |

> The privacy URL must be reachable by the reviewer. A hash route works, but a clean path
> (`/privacy`) is safer — see the note at the end.

## Full description (≤4000)

```
TengaSell is Zimbabwe's online auction marketplace — a snap to your happy deal.

Bid in US dollars on phones, solar equipment, vehicles, appliances, collectibles and more, or
list what you no longer need and let the bidding find its price. Built for how Zimbabwe actually
trades: USD pricing, Paynow checkout (EcoCash, InnBucks, cards, ZIPIT), and local pickup or
nationwide delivery.

WHY TENGASELL

• Live auctions and timed closings — countdowns that actually tick, anti-snipe protection so a
  last-second bid can't steal the deal, and automatic (proxy) bidding that bids the minimum
  needed to keep you in front.
• Best offers — when an auction isn't the right fit, negotiate directly with the seller.
• Buyer protection — your payment is held until you confirm delivery. Sellers are paid after
  the 7-day dispute window closes without a problem.
• Verified sellers — ID-checked, with public ratings and response times earned from real
  behaviour, not promises.
• Plain-English rules — fees, service levels and refunds are published in the app, with no
  small print.
• Tenga AI — a trading assistant that helps with fair prices, deal hunting and listing copy.

SELL IN MINUTES

Snap a photo, pick a category, set a price (or let the market decide), pin your location for
pickup, and publish. First 50 listings a month are free; an 8% final-value fee (capped at US$50)
applies only when your item sells. Optional US$2 featured placement puts your listing in front of
more bidders.

TRUSTED BY DESIGN

Escrow-style payment holding, mediated messaging that keeps personal contact details private,
moderation of reported listings, and a published dispute process with evidence review.

TengaSell is a marketplace intermediary: the contract of sale is between buyer and seller, and
Zimbabwean consumer law protections apply. Support: support@tengasell.com — we reply within 24
hours, Monday to Saturday.
```

## Graphics inventory (`assets/play/`)

| Asset | File | Size | Notes |
| --- | --- | --- | --- |
| App icon | `icon-512.png` | 512×512 | Brand mark, teal `#19717B` |
| Adaptive/maskable | `icon-maskable-512.png` | 512×512 | Mark inside 60% safe zone |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 | Wordmark + tagline |
| Screenshots | `screenshots/01-home … 06-search.png` | 1080×1920 | 9:16, captured from the live UI |

Screenshots cover: home, category browse, live room, sell landing, help/SLA, search.

## Data safety — answers to enter

| Question | Answer |
| --- | --- |
| Does your app collect or share user data? | **Yes** |
| Data types collected | Personal info (name, email, phone, address); Financial info (payment references, purchase history); Photos (listing images); Messages (buyer–seller threads); App activity (bids, orders, searches); Device or other IDs (IP, session/audit logs); Approximate location (pickup pin) |
| Is data shared with third parties? | **Yes** — payment processing (Paynow), email/SMS/WhatsApp delivery, AI assistant provider, mapping tiles |
| Is data encrypted in transit? | **Yes** (TLS) |
| Can users request deletion? | **Yes** — Privacy Centre in-app, or privacy@tengasell.com |
| Is data collected for advertising? | **No** |
| Committed to Play Families policy? | **No** — the marketplace is 18+ |

## Content rating — expected answers

| Section | Answer |
| --- | --- |
| Violence, blood, sexual content, nudity | No |
| Profanity | No (user-generated listings are moderated) |
| Controlled substances | No — pharmacy/medicinal listings are prohibited by the marketplace rules |
| Gambling / simulated gambling | No — auctions are a marketplace, not wagering |
| User-generated content | **Yes** — listings, Q&A and messages; moderation + reporting are in place |
| Shares location | **Yes** — pickup location on listings |
| Digital purchases | **Yes** — listing fees/featured placement (if enabled) |

Expected outcome: **Rated for 18+ / Mature**, primarily because of user-generated marketplace
content and financial transactions.

## Note on the privacy URL

Play prefers a stable, crawlable URL. Two options once hosting is restored:

1. Keep `/#/policies/privacy` (works, but a fragment is not a distinct page).
2. Add a real path route `/privacy` that renders the same policy — cleaner for review and for the
   Data safety form. Recommended before submission.
