# TENGASELL-PULSE-DESIGN-01 — Home 2.0 Controlling Master Plan

**Version:** 1.0.0 — PROPOSED / DESIGN-FIRST  
**Plan ID:** TENGASELL-PULSE-DESIGN-01 (continuation of the Owner-selected TengaSell Pulse Hybrid, NOT a competing programme)  
**Repository:** kudzimusar/tengasell-auction  
**Plan authority:** this file on the dedicated documentation Draft PR; becomes controlling for further specialist assignments only following Owner acceptance  
**Established:** 2026-11-24 (Asia/Tokyo)  
**Author:** Programme Moderator — plan and governance, not UI implementation  
**Independent reviewer:** @11-eleven-skm (review request NOT YET DISPATCHED)  
**Status:** DESIGN PLAN PROPOSAL; NO IMPLEMENTATION, MERGE, PREVIEW CUTOVER, PRODUCTION, BILLING OR DATABASE AUTHORITY

## 0. The Owner's immutable goal and moderator operating agreement

The existing TengaSell homepage static illustrated hero is dated, redundant, weak at communicating genuine activity and poor at commercial conversion. Replace its purpose with **TengaSell Pulse Hybrid**: search-first discovery, authoritative live-auction experience, role-aware buyer/seller/business home, and a governed sponsored-commerce surface across web, tablet, PWA, native iOS and native Android. Include AI to assist customer communication and operations and relay critical information safely.

The Moderator must own this plan, not build the feature: issue bounded tasks to existing specialists, independently inspect exact commit/PR evidence after each return, issue exactly one **ACCEPT**, **REMEDIATE** or **BLOCK**, patch the plan/acceptance register when corrections are identified, and keep work within the accepted stage. Never substitute attractive mockups, green CI or agent claims for authoritative runtime, payment, privacy or physical-device certification.

The execution loop is: **OWNER GOAL → ACCEPTED PLAN → D0 source/asset inventory → D1 IA/contracts → D2 two visual directions → Owner visual choice → D3 responsive interactive prototypes → independent design review → Owner design acceptance → separately authorized implementation slices → integrated certification → Owner release decision.**

A successful first Draft plan PR is NOT an accepted product design. An accepted visual prototype is NOT implementation authorization.

## 1. Protected baseline and custody snapshot — verify again before every assignment

Source authority: current accepted baseline and approved governing contracts outrank this design proposal; Draft branches are isolated candidates, not accepted main. Values below were read from live GitHub on 2026-11-24; refresh exact HEADs and reviews at dispatch, integration planning and review.

| Surface / programme | Custody snapshot | Control |
| --- | --- | --- |
| Current web homepage | main: src/components/tengasell/pages/home/hero.tsx and home-page.tsx | Existing hero, quick chips, how-bidding-works strip; replace only after later authorization |
| Web UI primitives | src/components/tengasell/ui.tsx; home/category-grid.tsx; home/sections.tsx; home/closing-soon.tsx | Reuse AuctionCard, authentic live display, cards, states and navigation |
| Brand authority | nxs-experience-manifest.yaml; src/app/globals.css | Official NXS tokens, accessibility, responsive navigation, i18n |
| Auction parent | Draft PR #5, 3e4c0359bef6fc43c851e79ba7e0a43589d557e6 | No unapproved commercial authority or DB changes |
| SEC-01 | Draft PR #12, af40bc02a41f7bc75bb6610fdf77909669121865 | Auth, RBAC, revocation — independent authority |
| Product Intelligence | Draft PR #14, feda45801f87b2cda85ef0e0a26f3d7ca145ce92; #15, 6cff74237ce1813b6e530f946149de7e78cff623 | Public product/search projection must be independently accepted before data integration |
| Live Communications | Draft PR #17, f083a2bc62ff1384ede1054f18d0b8c8546c10f0; #19, cc349fa9b64fc4ac79fa8cd3f2a3d51e306cb84b; #20, 9e4d30835d681b571351fff214172d34149e4b56 | Real live room, status, reminder authority must not be copied from uncertified draft code |
| Native Mobile | Draft PR #21, c9fd6f8c2b0f40e562c6154a725636ba3d738923, parent PR #9 SHA 9bd369ad7000c7564195c1249d75759064706068 | Expo SDK 58 / React Native 0.88.1; native source + provenance + physical UAT remain distinct |
| Existing AI | NXS manifest describes Tenga AI assistant (text-first, voice planned); existing web assistant links | This plan extends an existing product direction; it does not assert a ready production autonomous AI operator |

Note: user screenshot shows localhost:3100. The Moderator inspected GitHub source, NOT the user's private localhost runtime. Inspect an authorized local preview only when a specialist provides reproducible access/evidence, and never infer its commit from the screenshot.

The web PR #17 contains richer pending R1 live auction gateways than main. Do not silently use it as the implementation base. Design against both main and the approved future contract; disclose divergences.

## 2. Scope contract — what stays, what changes, what does not exist yet

**Preserve:** TengaSell official name/brand and approved media; NXS semantic colors; existing auction authority, account roles, listing eligibility, disclosure, card primitives, localization, routes, seller flow, search, category taxonomy, native bottom navigation and preview/release gates.

**Design:** one modular, role- and state-aware homepage; genuine search and categorization; authoritative live/upcoming feature; real listing rails; transparent promotion slots; opt-in personalized buyer/seller/business modules; AI customer assistance and operations status triage; editorial campaigns; trustworthy seller calls to action.

**Explicitly do not implement now:** frontend components or styles; Expo source; API endpoints; database tables/migrations; billing, wallet, Stripe/Paynow, escrow, advertiser charges; push provider or messaging activation; autonomous bidding, offers, funds, listing removal or release; production AI ingestion; release bundles; merging Draft PRs.

**No fabricated commercial truth:** example vehicles, bid counts, viewer counts, sponsored brands, discounts, seller verification, escrow statements and customer testimonials are DESIGN FIXTURES labeled "illustrative". Live views only show authoritative live state. Marketing cannot override auction eligibility or payment truth.

## 3. One experience architecture, not four homepages

Module IDs are stable across designs, source contracts and tests:

| Module | Purpose | Required safety | Monetization |
| --- | --- | --- | --- |
| P01 Pulse Search | Visible search, real categories, query suggestions | Public taxonomy; private queries per account only | No paid overriding organic search |
| P02 Pulse Live | Verified live room or eligible upcoming event | Canonical event/session/lot match, honest unavailable/awaiting state | Eligible labeled event sponsorship |
| P03 Pulse Discover | Closing soon, new, featured, categories, recommendations | Public listing truth and status freshness | Paid listing boost as labeled inventory, no bidding preference |
| P04 Pulse For You | Watchlist, saved searches, relevant reminders, account shortcuts | Auth, ownership, consent, ACL, expired-session fallback | Retention/optional opt-in promotions |
| P05 Pulse Sell | Individual listing, merchant acquisition, business tools | Real seller capabilities; no fictional results | Merchant/storefront/Pro lead generation |
| P06 Pulse Promote | Sponsored placements, seasonal editorial, category partners | Explicit ad label, approval, eligible listing, end date, takedown | Commercial packages subject to later Finance approval |
| P07 Pulse Trust | How auction works, seller verification, payments/delivery help | Only validated policies and accessible terms | Conversion via confidence; no unverified payment promise |
| P08 Pulse Assist | Tenga AI help, summarized operational alerts, critical action-required communication | Source-backed RAG, safe escalation, opt-in, human approval and audit | Support efficiency and seller-business assistance, no unauthorized autonomous monetization |

**Shared composition policy** (design contract, not new backend authority):
- Guest/no verified live: P01 → P03 → P07 → P05 → P06.
- Guest/verified live: P01 → P02 → P03 → P06 → P07.
- Buyer: P01 → P04 → P02 if verified → P03 → relevant P06.
- Individual seller: P01 → P05 → listing-management shortcuts → P03.
- Business: P01 → P05/storefront tools → authorized inventory/campaign summary → P03 → P06.
- Unavailable canonical authority: NO LIVE badge, no stale price as current, no demo as real; safe public discovery and retry.
- No paid creative may displace all organic search/results or supersede canonical safety gating.

## 4. Responsive layout contract and view inventory

| Surface | Design reference widths | First useful content | Grid / constraints |
| --- | --- | --- | --- |
| Desktop web | 1280, 1440, 1920 CSS px | Search + active/organic feature + partial real inventory above fold | 12-column; primary 8/12, safe sponsored/sidebar 4/12 only if eligible |
| Tablet web | 768, 834, 1024, 1194 CSS px | Search + actionable feature | 8-column to stacked; touch, portrait/landscape |
| Mobile web / PWA | 320, 360, 390, 430, 600 CSS px | Search + categories + one useful feature and accessible inventory | One primary card; no full-screen takeover ads |
| iOS native | 375, 390, 430 pt, plus device safe areas | SearchHeader → category shortcuts → active/organic card | React Native native controls, Dynamic Type, 44pt touch |
| Android native | 360, 393, 412 dp, plus larger screens | Search → category shortcuts → relevant card | React Native native controls, TalkBack, ~48dp touch |

**Thirty mandatory concept views** (each captures state and source label, not merely screen size):
- Desktop D01 guest/no live; D02 verified live; D03 upcoming; D04 signed buyer; D05 individual seller; D06 business with sponsored campaign; D07 empty sponsor; D08 offline/unavailable.
- Tablet T01 portrait discovery; T02 landscape live; T03 business; T04 large-text reflow.
- Mobile web W01 guest search; W02 live; W03 categories; W04 buyer; W05 labeled ad; W06 unavailable.
- iOS I01 guest; I02 watchlist; I03 live; I04 seller; I05 business; I06 unavailable.
- Android A01 guest; A02 live; A03 buyer; A04 seller; A05 labeled ad; A06 large text/unavailable.

Ten interactive prototype journeys: search→listing, verified live→room, buyer→saved item, seller→sell flow, business→plans (no charge), ad→approved listing, no-live→upcoming/organic, offline→retry, expired session→public/sign-in, accessible keyboard/screen reader path. Prototype transactions are simulated and explicitly labeled.

## 5. Monetization and client/account architecture

Design six future products as hypotheses only: Listing Boost, Sponsored Listing/Category, Merchant Collection, Event Sponsorship, Business Storefront and Seller Pro. No fee or monthly revenue target is approved. Do not infer that a wallet, escrow or recurring subscription engine is deployed merely because one is visually illustrated.

Campaign concept contract: campaign_id, advertiser_id, authorized owner, approval state, consent/targeting basis, slot_id, placement/surface, category/region scope, eligible public listing IDs, creative versions/rights, CTA target, start/end UTC, frequency cap, finance contract reference, publication/withdrawal audit, viewable impressions and qualified clicks. Design states DRAFT→SUBMITTED→APPROVED→SCHEDULED→ACTIVE→COMPLETED plus PAUSED/REJECTED/WITHDRAWN/EXPIRED. **No migration or endpoint authorized by this schema sketch.**

Every paid surface: visible "Sponsored" or "Ad" label; no fake reviews; protected identity, reserve and bid data never sent to advertisers; advertiser cannot alter ranking authority, bid results or verification. Withdrawn/private/expired lots are ineligible even when a paid campaign has time remaining. Campaign service down ⇒ fall back to organic content. Business accounts only see authorized company/storefront/campaign data; regular seller sees only own inventory. Geographic/role segmentation must be lawful, auditable and not reveal private user categories.

Research commercial supply and pricing only after D2, and ask Product/Finance to accept packages before implementing billing. Distinguish first-party editorial promos from advertiser-paid placements.

## 6. Tenga AI — two bounded product lanes

**Lane A, customer-facing Pulse Assist (design first):** Help discover listings, explain auction mechanics and policies, interpret a watchlist or saved search after authorization, summarize canonical event schedules, guide seller listing intake and explain fees using approved published sources. Show context/citation/source timestamp when answer depends on auction data. Present uncertainty and route to human support when state is unverified. Language: existing English default, existing Japanese localization test, future Shona/Ndebele only after localization and safety evaluation. Text-first; voice remains proposed and is NOT automatically activated.

**Lane B, internal Operations Copilot (design only):** Consume permitted event summaries from authoritative services after safe integration: event/lot mismatch, failed reminders, outbox backlog, missing catalog source, promoted withdrawn listing, near-expiry campaign, infrastructure outage, privacy/abuse alert, missing physical-UAT evidence, checkout/provider mock-mode status. Produce concise alert cards with severity, timestamp, source ID, impacted service, confidence, suggested runbook and *human-acknowledgement* state. Owner/operator role access and audit required.

**AI non-authority:** AI must not determine LIVE/SOLD/VERIFIED/reserve disclosure; bid, retract, charge, refund, release escrow, publish listing, send bulk external communications, approve ads, block accounts, change ACLs or deploy code. It suggests; deterministic domain services decide; humans explicitly approve consequential actions. No secrets or private cross-user data in prompts/telemetry. AI disabled ⇒ standard search, deterministic notices, plain status dashboard all continue functioning.

**Critical information tiers (proposed):**
- SEV0: suspected private data disclosure, incorrect bid/payment authority or active critical incident → human-controlled immediate incident route, fail closed on public claims.
- SEV1: live room/data-state mismatch, auth failure, communication-delivery backlog or promotion of withdrawn stock → operator actionable alert, monitored during active sessions.
- SEV2: conversion drop, campaign expiry, inventory freshness, support trends → business operational queue.
- INFO: informative user reminders under approved consent/channel.
Each alert needs source-of-truth lookup, deduplication key, delivery policy, acknowledgement, escalation/expiry, access audit and deterministic fallback if AI/provider is down. No external SMS/WhatsApp/email/push until separate communications/security approval.

See AI_AND_COMMERCIAL_BOUNDARIES.md for proof matrix, data flow and authorization.

## 7. Responsive creative and official brand custody

Canonical palette from NXS + globals.css: primary teal #19717B, deep teal #0F4A50, gold #DFAE2E, deep gold #AF7A14, light teal #6CBEC2, canvas #FAFAF7, ink #1C2424. Use semantic tokens; no substitute logo or unapproved campaign brand. Verify official logo/media files and rights before any final creative; source and owner must be in asset-manifest. Prototype-only AI-generated photos must be visibly labeled fixtures. Never bake essential text into images. Desktop landscape + mobile 4:5/square crops, compatible retina variants; verify file-size budgets, alt text, object focal point, light/dark and safe-area adaptation. No font files shared outside the authorized workspace.

Existing NXS navigation, localization, reduced-motion, high contrast, screen reader, 44px web targets and responsive scroll restoration are preserved. Native variations use platform conventions; web mockups are not proof of native implementation.

## 8. Performance, security and measurement

Proposed budgets (validate before engineering): web LCP <=2.5s, INP <=200ms, CLS <=0.1 at p75; user interface must remain useful on slower data, reduced motion, offline and high font scale. No large autoplay-video requirement. Lazy noncritical media, correct image aspect ratio, deterministic live-state fallback and safe skeletons. Android must not continuously poll/hog battery.

KPIs require real baselines: search initiation, search→detail, eligible live-room entry, watchlist engagement, seller start/completion, repeat visits; campaign fill, qualified sponsored actions, paid conversions only after commerce enabled; guardrails include organic discovery, crash-free native sessions, accessibility, performance, complaints and misleading promotions. **Accepted coverage = NOT_BASELINED** pending Owner-approved work-package denominator. Never invent growth or revenue.

Data contracts and UI states must be tested as anonymous, buyer, seller, business admin, operator, banned/expired account, unavailable authority and stale-data recovery. No protected identity or private seller-price field in public response or analytics. Restricted event/source evidence must use an access-controlled channel, not public PR attachments.

## 9. Controlled stage-gate delivery (cumulative, no skipping)

| Stage | Agent owner | Required deliverable / exit | Moderator control |
| --- | --- | --- | --- |
| P0 PLAN | Moderator | This durable scope, baseline and initial register | Owner accepts design-planning authority; no app modifications |
| D0 SOURCE/MEDIA | Existing UX/Design specialist + brand custodian | Verified main/PR21/PR17 component inventory; approved assets, licensing, omissions | Exact source links, no new design system |
| D1 IA/TRUTH | UX + data-contract specialist (consultation only) | 8-module architecture, 5 role states, live/empty/error contracts, surface content map | Verify each visible claim has authority; no schema mutation |
| D2 TWO DIRECTIONS | UX + brand creative | Pulse Precision and Pulse Editorial, desktop/mobile directions, commercial/AI cards, variant comparison | Owner chooses or merges precise visual aspects; no generic alternatives |
| D3 PROTOTYPE | UX + native UX consultant | 30 views, 10 journeys, responsive behavior, annotated reusable components | Verify real interactive navigation and accessibility, distinguish prototype behavior |
| D4 INDEPENDENT DESIGN GATE | @11-eleven-skm | Formal review of exact immutable design version with ACCEPT/REMEDIATE/BLOCK | Reviewer separate; Owner then accepts design |
| I0 ENGINEERING CUSTODY/INTEGRATION PLAN | Moderator + web/native/security leads | Per-PR dependency DAG, accepted exact heads, API contracts, migration boundary, feature flags and rollback | **Separate Owner authorization prerequisite** |
| I1 WEB SLICE | Existing web specialist | Approved Pulse layout without replacing auction authority | Web E2E/visual regression, exact-head CI/review |
| I2 NATIVE SLICES | Existing native mobile specialist | RN native components and verified JS+binary provenance | Expo build/Metro/native-runtime gates in MOBILE_BUNDLE_BOUNDARY.md |
| I3 AI/ALERT SLICE | Existing AI/Comms specialist | Human-gated sourced assistant + deterministic critical alert delivery | Privacy, incident/audit, delivery tests, opt-in and reviewer approval |
| I4 COMMERCIAL SLICE | Existing seller/commercial specialist | Approved campaign inventory, admin approvals, revenue tracking | No billing/provider activation without Finance/Owner |
| I5 CROSS-SURFACE UAT | Independent QA/security + human device operator | Browser + physical iOS/Android, role/scenario matrix, real service negative tests | Test exact integrated candidate, don't inherit unrelated PR approvals |
| I6 ROLLOUT | Owner-controlled operations | Staged flags, observed metrics, rollback, support readiness, explicit release decision | No merge/deploy/payment/live communication without separate Owner approval |

No specialist may advance a later stage just because earlier work is "done" by self-report. Design gates D0-D4 can proceed under approved design authority; engineering I0-I6 must receive new authority. A first visually chosen direction is NOT a branch/merge instruction.

## 10. Immutable acceptance tests and progressive task boundaries

The first authorized specialist unit after plan acceptance is **PULSE-D0D2-01**, described completely in AGENT_ASSIGNMENT_D0_D2.md. Its allowed outputs are research/design/prototype artifacts and evidence; NEVER app code, migrations, release changes or background AI execution. Independent reviewer receives evidence after acceptance of D0-D3, not the same agent's self-approval.

Contract-level UAT matrix for eventual feature:
1. No authoritative live event ⇒ no false LIVE banner/countdown/bid CTA.
2. Verified session+event+lot ⇒ eligible live card only; stale disconnect neutralizes it.
3. Guest account ⇒ no user-specific preferences or analytics leakage.
4. Expired buyer ⇒ public fallback; no protected watchlist residue.
5. Seller/business roles ⇒ authorized company-specific actions only.
6. Promoted withdrawn/private listing ⇒ removed and replaced by organic content.
7. Sponsored campaign expiry ⇒ no impression, click or ongoing promotional guarantee.
8. No campaign ⇒ full marketplace usable with organic content.
9. AI hallucinated bid/reserve or payment claim ⇒ suppressed; deterministic authority shown.
10. Critical event ⇒ deduped alert, restricted recipient, ack/escalation, audit; AI outage still generates rule-based alert.
11. PWA offline ⇒ no live authority claims; cached content labeled stale.
12. Native JS refreshed with old binary ⇒ compatible runtime checked, precise SHA shown, no false binary certification.
13. Android/iOS accessibility scaling, back, notches, screen reader and low network.
14. Exact-source visual screenshots and signed release artifact provenance required for final I5/I6.

Every task report must label tests as REAL TRAILBASE / EMULATOR / UNIT MOCK / BROWSER / NATIVE SIMULATOR / PHYSICAL DEVICE; don't treat any as interchangeable.

## 11. Change control and defect protocol

Every agent must state: task ID, authorized parent SHA/branch, file and environment scope, exact candidate HEAD, diff list, test commands/results, screenshots/artifact SHA-256, known omissions, cost impact, blocked dependencies and next reviewer. Critical shared file overlap triggers MODERATOR REVIEW before coding. Different specialists cannot silently edit the same authority surfaces.

Moderator decision:
- ACCEPT only if all bounded criteria independently verified at exact immutable candidate.
- REMEDIATE for specific reproducible correctable defect, same specialist, existing branch and named negative test.
- BLOCK for missing authority, unsafe data, reviewer separation, source custody drift or untestable release dependency.
If a candidate changes after review, previous approval does not cover the new HEAD.
Any plan/scope alteration needs versioned amendment, Owner decision, impact and explicit stage rollback if needed. Never quietly "improve" the accepted goal.

Per material event update the DELIVERY_REGISTER.md: task, agent, state, acceptance, exact source/reviewer/evidence, blocker and next action. No invented percent: NOT_BASELINED until accepted denominator is committed. Add a successor handoff in the register at each phase boundary or context transition. This plan stays accessible by stable repo path and should be re-read before each assignment.

## 12. Ownership, readiness and immediate next action

**Moderator:** own plan/custody/review/patch coordination; never self-certify or silently build.
**Existing UX/Design specialist:** initial design owner; identity/dispatch pending confirmation by Owner or active specialist.
**Brand/Media custodian:** assets and rights.
**Commercial/Finance:** monetize only after Product approves hypotheses.
**AI/Comms specialist:** future assistant/alert design consultation, no provider activation.
**Existing web/native specialists:** consultation for feasibility, no code edits yet.
**Independent reviewer:** @11-eleven-skm, separated from design and implementation author.

**Current state:** PLAN_PROPOSED / DESIGN_ONLY. Existing programme acceptance coverage: NOT_BASELINED. External agent dispatch: NOT YET CONFIRMED. No task background execution promised.

**ONE next authorized action after Owner accepts this docs-only plan:** dispatch bounded PULSE-D0D2-01 to the existing UX/Design specialist; obtain a traceable source/asset inventory and two visual directions; return them for Moderator review before advancing to D3.

**Hard stop:** NO APP CODE · NO NATIVE BUNDLE/OTA · NO MERGE · NO DEPLOY · NO DATABASE · NO PAYMENTS · NO EXTERNAL COMMUNICATIONS · NO AUTONOMOUS AI ACTIONS.
