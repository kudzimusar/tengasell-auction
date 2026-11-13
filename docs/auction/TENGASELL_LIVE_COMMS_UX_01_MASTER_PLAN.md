# TENGASELL-LIVE-COMMS-UX-01 — Master Product, UX and Communications Plan

> **R0 — Owner review. Documentation only.** No deployment, merger, migration, real provider activation or payment authority.

Status: R0 — Owner review / implementation not authorized by this document Prepared: 13 November 2026 Repository: kudzimusar/tengasell-auction Framework: 11-11 Tech NXS Framework 1.0 Custodian: Tengasell Programme Moderator Scope: Timed auctions, scheduled live auction events, shared live bidding rooms, product disclosures, subscriber communications and cross-platform presentation Release authority: None. Documentation only; no merge, paid-provider activation, migration or Production change.

## 1. Executive decision

Tengasell is one trusted marketplace with two clearly different buying experiences and one coherent communication system. A timed auction permits bids over a defined listing period. A live auction event is an auctioneer-led gathering in which participating buyers compete over the current lot inside a shared session. A listing's internal status='live' is NOT proof that a shared live-room event is on air. Customer-facing naming, colors and deep links must preserve this distinction.

The programme will connect discovery → deliberate follow/subscribe → consented reminders → qualified bidding → authoritative result → post-sale communications. It must reuse the existing TrailBase, Socket.IO trade engine, AuctionEvent/LiveSession/AuctionLot model, communications service (TUCS), and accepted Listing Intelligence design. No new parallel auction or messaging authority is allowed.

### Success measures (targets to baseline, not claimed results)

A first-time visitor distinguishes the two modes and reaches the relevant destination within two interactions on mobile.

Every red LIVE BIDDING NOW indicator represents an actual live session with a canonical current lot; a generic timed listing never receives that badge.

100% of notification sends have recorded source event, opt-in/eligibility decision, deep link, idempotency key, channel result and cost classification.

No user receives an auction reminder after the auction/event has become ineligible; no unauthorized social-channel message is sent.

Bid authority remains unchanged; notification failures cannot modify bids, settlements, reserves or legal gates.

Measured improvements are assessed against baseline: event discovery→room entry, room entry→qualified bid, timed-listing view→watch/bid, reminder→return, delivery rate, opt-out/complaint rate and conversion per delivery cost.

## 2. Source-control and evidence register

Verified repository references at planning: main 98a607c326ca4bcf24062c045d4eaa35762a3aa5; Draft PR #5 3e4c0359bef6fc43c851e79ba7e0a43589d557e6 (event/run-list engineering, unmerged and staging-custody check blocked); Draft PR #13 358a30956efa22be8ab48591b493e54579c896a4 (independently approved design only); stacked Draft PR #14 a47a816819b6370991d3d24940cda6f9c959b1a3 and #15 789862f6df2285b1ef58cbd1f401f29044381524 (published, unmerged). These are custody references, NOT evidence of Production availability.

| Existing code / contract | Observed fact | Gap to close |
| --- | --- | --- |
| src/components/tengasell/pages/live/live-room.tsx | Existing room board and #/live/{sessionId}, current lot, bid feed, auctioneer actions, socket updates/polling | Discoverability, state clarity, physical buyer UAT |
| src/components/tengasell/pages/events/auction-events.tsx | #/events calendar, scheduled/live/closed groups, event detail and run list | Event promotion, subscription, one-click true-room navigation |
| src/components/tengasell/pages/home/home-page.tsx | Live-room banner hides if no live/near-term room | Permanent auction-mode gateways |
| src/components/tengasell/pages/browse/ | Calls ordinary active listings live auctions | Replace with truthful Open for Bids labeling |
| src/components/tengasell/app-shell.tsx | Auction Hub and Live links exist in scrolling navigation; mobile five-tab shell | Clearly differentiated, discoverable entry points |
| mini-services/comms-service/{taxonomy,prefs,emit,queue,templates}.ts | Existing event taxonomy, preferences, linked providers, in-process queue, templates and suppression | New subscription/event reminder types; durable scheduler and revalidation |
| mini-services/comms-service/providers/ | Email/WhatsApp/Messenger/Telegram adapters support real credentials or mock mode | Policy-compliant templates/windows, delivery proofs and cost controls before activation |
| src/components/tengasell/pages/account/comms-center.tsx | Channel linking, preference matrix and recent notifications UI | Auction-specific follows, reminder timing, native push, delivery explanations |
| src/components/tengasell/pages/item/item-page.tsx | Timed item details and bids; no explicit live-room link in inspected source | Contextual room/event navigation where linked |

Evidence classification: Existence of UI/code is not confirmation of a running deployment, working provider credential, approved Meta messaging template, live-user participation, authenticated TrailBase enforcement or a certified mobile release. The PR #5 staging-custody blocker remains separate. Developer must recheck exact source before work and record changed status.

## 3. Canonical auction vocabulary and state semantics

| Product concept | Authority | Customer-facing state | Color / copy rule |
| --- | --- | --- | --- |
| Timed auction | Canonical Auction + trade engine | Open for Bids, Closing Soon, Ended, Sold | Teal/neutral for open; amber for approaching deadline; never red ON AIR |
| Event | AuctionEvent | Upcoming Live Event, Event In Progress, Event Completed, Cancelled | Schedule labels neutral/teal; event-level progress not equivalent to an open lot |
| Shared room | LiveSession | Room Scheduled, Room Open — Awaiting Next Lot, Room Closed | Red only if current bidding is truly on air |
| Active shared lot | LiveSession.current_lot_id plus authoritative lot/event lifecycle | `LIVE BIDDING NOW` | Red ON AIR badge, red dot, textual label; valid only with consistent authoritative state |
| Connection state | Socket/heartbeat & fallback | Connected, Reconnecting, Updates Delayed | Warning neutral/amber; never show stale bid as confirmed live |
| Listing linked to event | Verified event→session→lot linkage | View Upcoming Event or Enter Live Room | No action or promise without actual linked session ID |

Red contract: Use the existing semantic danger/urgent token or its approved accessible red variant, not an arbitrary new brand system. Red conveys an actual active live lot; red text is never the only differentiator (also icon, explicit label and accessible status). Pulsing animation is optional, subject to reduced-motion settings. A timed listing nearing close is not a live room. The seller's Sell CTA does not imply room membership.

Event consistency: AuctionEvent → LiveSession → AuctionLot is the existing linked authority. An event ID must never be used as a session ID. A room being live with current_lot_id=null means waiting, not bidding. If event/session/lot state disagree, fail closed in UI: display Status temporarily unavailable; disable unsupported entry/bid affordances; retain safe read-only context. Do not fabricate occupancy, video, bidding heat or vehicle results.

## 4. Information architecture and commercial presentation

Top-level discovery: permanent paired home entry cards Timed Auctions — Bid at your pace and Live Auction Events — Join the bidding floor. On mobile they appear above the long product feed; never disappear when no events exist. Primary browse mode remains a regular marketplace, and the distinct event destination is #/events; #/live remains the actual room board and #/live/{sessionId} an individual room. Preserve current five-tab mobile navigation unless approved user testing demonstrates a bounded improvement; place direct Live Events entry within a persistent, accessible home/header/menu surface.

Timed listing card: truthful Open for Bids, item image, verified title, location, current bid, end time/countdown, bid count, watch action, View & Bid. If event-linked, show a secondary verified event association; do not duplicate an auction as a separate listing. Treat notification subscribe/watch as a separate action from placing a bid.

Live-event card: real title, category/vehicle focus, date/time with timezone, real lot count, official host/operator label, venue/online designation, Live Now/Upcoming/Completed, CTA Enter Live Room only when appropriate; otherwise View Event. Display actual vehicle run-list previews and real images; avoid fake attendance counters. In empty state, show No live events scheduled plus Explore Timed Auctions and Get notified when events are announced only if a working subscription flow exists.

Vehicle room, desktop hierarchy: (1) always-visible event title/status + connection strip; (2) dominant current-lot stage, real image gallery, year/make/model/trim and canonical condition; (3) prominent current bid, valid next increment, hammer clock and bid control; (4) recent masked bid activity; (5) current/next run-list and event context; (6) disclosure tabs, provenance/evidence status, seller/inspection labels, eligibility, reserve disclosure as allowed. Auctioneer console is visually and permission-wise separated from buyer controls.

Mobile hierarchy: compact red ON AIR header only during actual live bidding; current vehicle identity/photo and current bid first; sticky authenticated bidding CTA with confirmation and keyboard-safe layout; collapsible Vehicle Facts, Bid History and Coming Next; accessible persistent Next Lot/run-list affordance. Connection loss raises a visible banner and disables any unsupported action until the canonical engine permits it. Focus, touch targets, 390px/768px/1280px/1920px, RTL-safe layout where applicable and reduced-motion are mandatory UAT dimensions.

Product Intelligence reuse: use the approved PR #13 disclosure framework (manufacturer, model, actual manufacture date versus model year, ownership declarations, repair history, known defects, included accessories, evidence state, seller reliability), but render only verified available fields. UNKNOWN, NOT PROVIDED and NOT APPLICABLE must remain distinct. Do not expose VIN, IMEI, max-proxy bids, identity documents or unverified inspection claims. Do not make the live-room screen an unrestricted disclosure editor.

## 5. Universal subscription, watch and reminder model

A subscription is a deliberate, revocable preference, not automatically inferred from page visits, a bid, a followed seller or a Facebook interaction. Separate:

WATCH_LISTING — track a timed listing, with selectable ending/outbid events.

FOLLOW_EVENT — receive a scheduled event's start, changes, cancel and start notifications.

FOLLOW_EVENT_LOT — track one specific vehicle in an event's run list; notify when that lot becomes ready or is on air.

SAVE_SEARCH — alerts for matching inventory; unrelated to a particular bidding room.

FOLLOW_SELLER — future discovery feature, marketing consent rules apply; not automatically enabled.

A user may follow an event without being qualified to bid. Event reminders are informational and must not imply admission or bidding eligibility. A bid placed does not automatically consent the buyer to WhatsApp or Messenger marketing. Notification channels require their own verified destination and consent. Suppression and unsubscribe override routine preferences.

### Proposed event taxonomy extension (versioned, not yet implemented)

| Event key | Trigger source | Audience | Category |
| --- | --- | --- | --- |
| auction.outbid (existing) | Canonical leading-position change | Affected bidder only | Account-specific transactional |
| auction.ending_soon (existing) | Deadline scheduler and live state recheck | Opted-in watchers/bidders | Requested reminder |
| auction.won / auction.sold (existing) | Authoritative finalization | Relevant winning buyer/seller | Transactional |
| event.announced | Canonical scheduled event created | Interested opt-in audience | Potential marketing; policy-classify |
| event.start_24h, .start_1h, .start_10m | Scheduler, revalidated | Event followers with chosen cadence | Requested reminder; provider review |
| event.started / .delayed / .cancelled | Canonical lifecycle | Followers, affected participants | Event-specific operational |
| event.lot_approaching | Locked or trustworthy current/next run list transition | Lot followers | Requested reminder; no fabricated ETA |
| event.lot_live | Current lot enters authoritative bidding state | Lot followers | High priority with rate cap |
| event.lot_result | Canonical hammer/pass | Relevant participants/followers | Results, privacy-filtered |
| account.comms_delivery_issue | Provider failure/suppression | User via in-app only | Operational |

Timing policy proposal: timed listing watchers choose 24h / 1h / 10m closing reminders (default a conservative single reminder, not all three). Event followers choose 24h / 1h / 10m schedule reminders; lot followers receive lot approaching when the engine actually knows the next/current lot, then at most one lot live notice. Never predict a minute-level lot start from queue position alone. Owners may adjust defaults after delivery data and user testing; marketing is OFF by default.

Outbid logic: notify only after the authoritative auction engine determines that this buyer is no longer leading, not every competing bid or proxy movement. A duplicate, stale or superseded event must not produce extra messages. No public channel may expose the bidder's maximum proxy amount, private reserve or competing bidder identity. Results must be sent only after authoritative settlement state is known.

Reschedules and anti-sniping: when a deadline changes, invalidate previous scheduled jobs and create a versioned replacement. Immediately before dispatch, check authoritative status, eligibility, current canonical end time, account subscription and channel consent; cancel obsolete reminders. During anti-sniping extensions do not send multiple ending soon messages per extension. Use an explicit event-version/idempotency key and a cooldown.

## 6. Omnichannel communications architecture and consent

One event, many eligible destinations: trade-engine or event authority emits a signed/validated domain event → durable outbox → policy classifier → subscription matching → preference, verified-link, consent and external-window check → priority/frequency/budget policy → durable delivery queue → provider adapter → webhook receipt → user-visible notification history and operator audit. The notification service never creates auction truth.

### Channel matrix

| Channel | Recommended role | Release prerequisite | Cost/availability boundary |
| --- | --- | --- | --- |
| In-app notification centre | Canonical record of important notices, link to item/event/room | Auth/ACL and read/unread states | First-phase default; app still needs reliable backend |
| On-screen room toast/banner | Current auction activity and safety warnings | Canonical socket events, reconnection handling | Does not replace durable notices |
| Email | Verified buyer/seller notices and chosen reminders | Verified address, templates, delivery tracking, suppression | Provider quotas; Resend is coded but not proof of live sending |
| Browser web push | Optional fast reminders when app closed | HTTPS, service worker, gesture-based permission, registered endpoint, device controls | No automatic permission; mobile browser limitations |
| Native mobile push | Future app-specific notifications | Mobile release, user permission, APNs/FCM/existing RN integration, deep-link tests | Separate mobile ownership and physical Android/iOS certification |
| WhatsApp Business Platform | User-opted event and bid notices | Verified opt-in, approved templates when required, conversation-window engine, policy/price review, webhook receipts | Billable by category/market; strict zero-cost gate until Owner approves |
| Facebook Messenger | User-initiated conversations and approved opted-in notifications | Page and app permissions, recipient PSID, 24h window or current approved eligible mechanism | Cannot freely message Facebook followers; no user ID scraping |
| Facebook Page posts/share | Optional public event promotion | Official Page permissions or user-initiated share | Public marketing, not a substitute for private bid notices |
| Telegram | Optional existing supported channel | Verified link, preference, provider policy | Already coded; not a substitute for requested channels |

Important 2026 pricing and policy finding: WhatsApp's official business FAQ says effective 1 October 2026 service messages are charged after the first 1,000 free service messages per business phone number per month; marketing, utility and authentication fees depend on category/market. Business-initiated conversations generally require templates and opt-in. The pricing page contains differing generalizations, so a live account rate-card and business-policy review is a release gate, not a hardcoded price assumption. Meta Messenger generally uses a 24-hour standard interaction window; sending later requires a currently available, specifically approved use case or explicit opt-in feature. Never rely on historic messaging tags or assume blanket access.

### Existing adapter risk: the inspected WhatsApp adapter sends type:text directly and does not implement an outbound approved-template/24h-window validator. The Messenger adapter uses messaging_type: RESPONSE without demonstrating current window eligibility. Real providers are activated by credentials, otherwise mock transcripts can appear successful. Before activation add fail-closed adapter eligibility checks, provider-specific templates, cost gates, response/webhook classification and mocks visibly marked SIMULATED, without changing existing communication authority. Do not send business-initiated WhatsApp/Messenger reminders through the existing generic response path.

### Data model additions (design, not DDL approval): subscription_targets, subscription_preferences, notification_events, notification_outbox, scheduled_reminder_jobs, channel_consents, delivery_attempts, provider_receipts, notification_read_state, provider_budget_policy, template_registry. Prefer compatible evolution of existing TUCS channel_links, preferences, outbound_queue, deliveries, suppression; avoid creating redundant user/contact authorities. Store consent version, purpose, source, captured time, withdrawal time, verified handle, provider policy window, template identifier, locale and send decision. Retention and data minimization require legal/privacy approval.

Delivery mechanics: at-least-once event delivery with durable deduplication; unique (source_event_id,user_id,channel,template_version,reminder_stage); idempotent provider calls where supported; exponential retry with finite deadline; dead-letter audit; time-to-live; unsubscribe/suppression recheck at dispatch; webhook authenticity and replay protection; failed deliveries do not automatically trigger paid-channel fallback. Persist queued, skipped_ineligible, blocked_consent, blocked_budget, provider_accepted, delivered, failed, expired (never equate API 200 with delivery). Show channel history and why did I receive this? UI.

Frequency/quiet hours: user-selectable reminder intensity and per-channel quiet hours; marketing default OFF and capped; batch nonurgent events; high-priority outbid/win/lot-live notices only when specifically enabled. Do not repeatedly notify the same recipient during a bidding burst. Design default caps for product review; do not claim fixed caps as enacted law. Respect unsubscribe immediately. Messages must have a direct, safe path to preferences.

## 7. Notification UX on web and mobile

Unified Notifications Centre: current auction notices, event reminders, direct messages and post-sale updates appear as separate tabs/groups with unread states, delivery channel icons, event timestamps, item image thumbnail when real, and CTA (View Bid, Enter Live Room, View Event, Manage Reminder). A red urgency indicator is used only for true active lot bidding or a confirmed critical warning, not every generic message. Plain-language labels explain outbid, starting soon, auction postponed, winning bid, and won without conflating them.

Subscription control: clear Watch this auction, Remind me, Follow Event, Notify me when this car is up controls on listing/event/room surfaces. Opening preference panel must show channel states, privacy and cost eligibility, delivery frequency, local timezone and ability to stop. In email/mobile notification deep links, the user lands on canonical item/event/room, authenticates if necessary, and is never auto-submitted into bidding.

Cross-device: web and native mobile share the same subscriptions, consent and notification history but OS-specific push tokens/devices remain independently revocable. Notification permission requests must follow a user gesture and use supported service worker path on mobile web. Unsupported channels are labeled Not available yet, not Connected. Browser foreground update should not trigger duplicate push/toast/email sequences.

Copy principles: clear subject with the actual item and event, one key fact and one CTA; user-specific status never sent as a broad broadcast; always specify timezone for scheduled sessions (Zimbabwe event timezone, plus viewer local time), never an unsupported bid amount or countdown. Accessibility includes text alongside colored badges, non-flashing red signal and screen-reader announcement limits.

## 8. Production-safe communications examples (proposed wording)

| Trigger | In-app / email message intent | Primary action |
| --- | --- | --- |
| Timed auction closing soon | Your watched Toyota Hilux auction closes in 1 hour. The closing time may extend if late bids are accepted. | View Auction |
| Outbid | You are no longer the leading bidder on [actual lot]. Review the current bid before choosing your next action. | Review Bids |
| Event upcoming | The [actual event] starts on [local date/time]. You are following this event. | View Schedule |
| Lot approaching | [Actual vehicle] is next in the run list. Timing may change as the auctioneer progresses. | View Event |
| Lot on air | [Actual vehicle] is LIVE BIDDING NOW in [actual room]. Join to view the current bid. | Enter Live Room |
| Postponed | [Actual event] is postponed. Your previous reminder has been cancelled; see the updated schedule. | View Changes |
| Won | You won [actual lot]. Review your official next steps in Tengasell. | View Order |

No message should imply an auction is paid, won or live until the authoritative service confirms it. Never use a link that can commit a bid from a single tap.

## 9. Roles, security and governance

Guest: browse timed listings, public event schedule and public event details; cannot receive account-specific bid notifications without authenticated subscription.

Buyer: follow/watch, manage verified channels, receive permitted notices, participate only after canonical bidder qualification; cannot invoke auctioneer controls.

Seller: manage own listing communications, see notifications relevant to their lot; cannot solicit private bidder identities or contact information.

Auctioneer/Clerk: event-scoped operations, authentic lifecycle announcements and run-list controls with audit, no bulk messaging privilege by default.

Communications operator: approve templates, review delivery/complaints/budget and signed campaign eligibility; cannot forge trade-engine bid outcomes.

Admin/security: manage policies and incident response; high-risk changes require audit and appropriate step-up.

Threats: user enumeration, fake urgency, forged event status, social-provider API abuse, opt-in laundering, impersonation, proxy-max leakage, bid-link CSRF, duplicate alerts, stale delayed notices, webhook replay, consent bypass, delivery-cost runaway and seller-to-buyer contact leakage. Test fail-closed behavior for each. Preserve seller/buyer mediated messaging moderation and do not convert external channels into unrestricted peer-to-peer messaging.

## 10. Iteration roadmap and gates

| Iteration | Bounded deliverable | Verification & exit gate |
| --- | --- | --- |
| R0 — Master plan (this document) | Canonical definitions, matrix, journey maps, comms architecture, user manual | Owner review, factual source audit; doc-only Draft PR; no runtime |
| R1 — Two auction identities | Permanent home gateways, status terminology, mobile/nav exposure, red semantic tokens, empty states | Physical UI at 390/768/1280/1920, a11y and route tests; no fake event data |
| R2 — Event and room presentation | Real event schedule, vehicle run list, lot stage, current bid, next lot, qualified bid CTA | Event→Session→Lot linkage, multi-bidder disposable UAT, role protection and reconnect cases |
| R3 — First-party follow/reminders | Watch listing/event/lot; in-app notification centre, scheduler, outbid and schedule reminders, preferences | Exact event tests, clock/reschedule edge cases, no duplicates, no irrelevant sends, real web/mobile display |
| R4 — Email + optional browser push | Verified email template, unsubscribe and receipts; permission-based web push | Mock/real separation, budget cap, delivery proofs, click/deep-link test and consent withdrawal |
| R5 — WhatsApp/Messenger readiness | Provider eligibility adapters, approved template registry, opt-in audit, channel costs | Independent privacy/security, provider sandbox compliance, zero-charge proof until approved; no production sends |
| R6 — Integrated certification/manual | End-to-end buyer/seller/operator UAT and documentation | Exact source, CI, Android/iOS physical evidence where applicable, independent APPROVE, Owner release gate |

Dependencies: PR #5 remains unmerged with staging environment authority not proven; PR #13 design accepted only; PR #14/#15 are unmerged stacked PI candidates. Do not combine these into this UX PR. Staging Fly/paid providers must be separately authorized. R3 can start with a compliant local disposable runtime without requiring R5 paid channels.

## 11. Canonical test matrix (minimum acceptance, not completed)

Ordinary active timed listing shows Open for Bids and no red ON AIR.

Genuine room live + current lot shows red LIVE BIDDING NOW and correct lot.

Room live + no current lot shows awaiting-next-lot, never live bidding.

Event scheduled or delayed cannot send a false lot live notice.

A guest sees schedule but cannot place a bid or access private notifications.

Authenticated buyer is denied bidding if qualification fails.

Two buyers concurrently bid in one room; prices/leadership reflect canonical engine.

Auctioneer hammer/pass updates event, room and run-list presentation correctly.

A viewer reconnects after socket drop; state is refreshed, never stale-confirmed.

One event follow sends one eligible schedule reminder per selected stage.

Reschedule invalidates prior jobs, updates UI and correct local-time display.

Timed auction anti-sniping extension does not spam multiple closing notices.

Outbid fires only on actual loss of leading position; max proxy stays private.

Watch cancellation and unsubscribe suppress queued future messages.

Email provider mock is visibly mock, not represented as delivered email.

WhatsApp send without required template/window/consent is blocked, even if token exists.

Messenger send outside eligible window/permission is blocked.

Per-channel daily/period budget blocks an over-budget paid message.

Web push permission denied leaves email/in-app usable and no broken UI.

A user opens a notice on mobile and returns to the authorized exact lot, not a fabricated bid.

Public bid feed masks participant identity and never reveals vault identifiers.

390/768/1280/1920px UI, keyboard, contrast, reduced-motion and long-text cases pass.

Operator templates and receipts prove actual-send status not merely queue acceptance.

No migrations, payment changes or production operations occur without separate Owner authority.

All tests require PASS / FAIL / BLOCKED with exact source SHA, environment, run IDs, screenshots/HTTP traces and independent reviewer. Static contract assertions are not equivalent to full browser or live TrailBase integration tests.

## 12. Measurement, content governance and cost control

Funnel: mode_exposed → mode_selected → listing_viewed / event_viewed → watched_or_followed → reminder_eligible → notification_delivered → return_visit → room_joined → bid_qualified → bid_accepted → lot_finalized. Segment by timed/event, web/mobile, timezone, new/returning buyer, channel and voluntary subscription status. Protect user privacy and avoid tracking marketing without permission.

Metrics: timed bid conversion, event RSVP/follow rate, room-entry rate, lot-live return rate, qualified bidder participation, valid bids per participant, delivery latency p50/p95, successful receipt fraction, stale-send rate (target zero), opt-outs/complaints, provider spend per valid returned bidder and event sell-through (do not causally attribute without controlled analysis).

Zero-cost posture: first implement local/in-app notifications and mock delivery; use existing infrastructure where permitted. No WhatsApp/Messenger paid template, Meta advertisement, Resend paid plan, staging Fly app, native push commercial service or Production KMS purchase without an explicit spending authorization and monthly spend cap. Default paid-channel budget $0 until approved. Never claim outbound service has zero cost merely because a provider offers a free tier.

Manual ownership: Product Owner approves mode labels and default reminder cadence; auction-engine owner approves event semantics; TUCS owner approves event/taxonomy/delivery; independent security/privacy reviewer approves provider compliance; mobile specialist verifies native behavior; Moderator records exact HEAD and gate dispositions. Update the user manual whenever any control or route changes.

## 13. Decisions and future opportunities

| Decision | Proposed default | Owner/reviewer gate |
| --- | --- | --- |
| Red live status | Only real shared current-lot bidding | Owner UX approval |
| Event entry | Auction Hub discovery; existing room for bidding | Product/UI review |
| Reminders | In-app first; user chooses cadence | Owner preference UX |
| Email | After verified address and dedicated eligibility | TUCS/security |
| WhatsApp/Messenger | OFF until policy, templates, consent, budget verified | Owner + legal + provider compliance |
| Web/mobile push | Permission-based, off by default | Platform/physical UAT |
| Late-bid and lot scheduling | Recheck canonical times; no predicted lot ETA | Auction authority |
| Facebook Page promotion | Optional editorial/public channel only | Owner branding and Meta approval |
| Promotional seller-to-event transfer | Separate later programme; retain physical-item identity | Owner trade-policy + PI integration |
| Live video/audio | Out of scope; never advertise as present | Separate explicit programme |

### Future iterations (not authorized yet)

A seller could request that a qualifying timed vehicle listing enter a live event without duplicating ownership or fact authority; followers could be invited to opt into that event. A calendar subscription and personalized run-list watchlist could increase return visits. Public event landing pages might support shareable preview images for Facebook/WhatsApp without triggering unsolicited private messages. These are prospective enhancements, not current implemented features.

## 14. Operating manual and agent execution rules

The companion TENGASELL_LIVE_COMMS_UX_01_USER_MANUAL.md explains both auction modes and controls in user language, explicitly distinguishing planned features from existing ones. This Master Plan is the proposed canonical product/design control, not an engineering implementation order. Future specialist dispatches must derive numbered work units and exact file boundaries from this document; every change needs its own source custody, CI, UAT and independent review.

Mandatory agent restrictions: (1) verify HEAD and existing work; (2) preserve PRs #5/#13/#14/#15 and mobile work; (3) do not invent provider permissions, message windows, bids, events or inventory; (4) never turn on real messaging or incur costs without explicit Owner approval; (5) no merges/migrations/Production; (6) demonstrate true session and auction state before exposing red live UI; (7) include exact-head independent verification and fail-closed evidence; (8) no parallel event, auction or communications authority.

## 15. External references and currency warning

WhatsApp Business Platform pricing and current categories: https://whatsappbusiness.com/products/platform-pricing/

WhatsApp Business FAQ (service-message policy updated for October 2026): https://whatsappbusiness.com/resources/faq/

WhatsApp Business Policy: https://whatsappbusiness.com/policy/

WhatsApp Platform features and opt-in/templates: https://whatsappbusiness.com/products/business-platform-features/

Meta Messenger Platform (official Meta Postman documentation): https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api

Meta Messenger developer policy: https://developers.facebook.com/devpolicy/

Apple web push guidance: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

MDN web notification permission: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API

Provider prices, templates, message-window exceptions and approved capabilities can change. Validate live terms again immediately before any provider activation. Legal compliance remains subject to qualified counsel and actual applicable Zimbabwe/recipient-jurisdiction requirements.

Disposition: R0 — DOCUMENTED PLAN FOR OWNER REVIEW. No implementation, messaging activation, deployment, merge or payment is approved by this document.
