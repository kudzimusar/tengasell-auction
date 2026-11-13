# Tengasell — Auction Modes, Live Rooms and Notifications (User Guide)

> **R0 — Owner review. Documentation only.** No deployment, merger, migration, real provider activation or payment authority.

User guide, version R0 (planned experience). This guide explains the proposed end-user experience and identifies what still requires engineering and testing. Some functions described below already have code or prototype interfaces but are not yet a certified public deployment. Do not interpret an example as an actual running auction.

## 1. Two ways to participate

Timed Auctions — Bid at your pace. Find a vehicle or other item, read its listing and condition/evidence disclosure, watch it, and bid before the published closing time. A listing marked Open for Bids is not necessarily part of a room. Late bids may alter the closing time under platform rules; always check the current deadline in the official item page.

Live Auction Events — Join the bidding floor. Find an upcoming scheduled event, see its vehicle run list and when it is due to start, and enter its associated room. A real auctioneer runs through lots; participants compete for the current vehicle. Only the room's authoritative current lot should show LIVE BIDDING NOW in red. No video feed is implied by the phrase live bidding.

## 2. Where to go

| I want to… | Intended Tengasell destination |
| --- | --- |
| Browse ordinary timed listings | #/search |
| View one item and its bids | #/item/{id} |
| Find planned live vehicle auction events | #/events (existing auction-event code, unmerged) |
| View an event and its vehicle run list | #/events/{eventId} |
| Find live rooms | #/live |
| Enter a particular room | #/live/{sessionId} |
| Choose notification channels | #/my/communications (existing TUCS UI) |

Use menu links rather than constructing an event/room URL manually: event ID and session ID are different. Some routes may be unavailable in the current deployment.

## 3. How to participate in a timed auction

Select Timed Auctions on the home page, then browse or search.

Open the item. Check make/model, manufacture/model year distinction, repairs, faults, accessories and verification status where actually available.

Select Watch Auction or Remind Me once these subscription controls are released. Watching should not itself place a bid.

Sign in and complete any necessary bidding qualification before entering a bid.

Confirm the exact amount in Tengasell; a notification link never places a bid on your behalf.

Watch for Outbid, Closing Soon, Won or Ended notices, based on your choices. A proxy bid maximum must never be displayed to other buyers.

## 4. How to participate in a live vehicle auction event

Select Live Auction Events and choose an actual event from the schedule.

View the run list and identify vehicles of interest. The exact time a particular lot appears can change.

Choose Follow Event and optionally Notify Me When This Vehicle Is Up, when released.

When the event opens, use Enter Live Room. The link must lead to the actual linked session, not an unrelated auction.

Check the room header. Upcoming means waiting; Room Open — Awaiting Next Lot means bidding is not currently active; the red LIVE BIDDING NOW state means the current lot is actually on air.

Review the current vehicle photograph, real condition/evidence, bid, minimum next bid and countdown. Use the existing bid-confirmation controls only if you are qualified and the connection is healthy.

Follow the masked bid feed and run-list transitions. When the auctioneer hammers or passes the lot, wait for Tengasell's official outcome before treating it as won.

## 5. Meaning of colors and statuses

| Indicator | Meaning |
| --- | --- |
| Teal/neutral Open for Bids | Regular timed auction is accepting bids |
| Amber Closing Soon | Timed auction is near the current official deadline |
| Neutral Upcoming Live Event | Event is scheduled, not yet active |
| Red `LIVE BIDDING NOW` | Actual shared session is running with a current lot |
| Room Open — Awaiting Next Lot | Room is open but no lot is under the hammer |
| Reconnecting / Updates Delayed | Your displayed bid status may be stale; verify before acting |
| Event Completed | Session has ended; official results are available only where confirmed |

Red is never used alone: readable text and an icon accompany the signal. A live room need not contain a livestream video.

## 6. Notifications: what you can choose

In-app: proposed default place to review notices and return directly to items/events. Email: for a verified email address, depending on channel preference and available provider. Web/native push: optional; you must grant permission on the device, and native mobile requires separately certified support. WhatsApp / Messenger: optional future delivery channels, not automatic. You must opt in, verify the linked account and the provider must permit that particular kind of message at send time. These channels may incur platform costs; Tengasell will not promise them without an enabled plan. Telegram: an existing optional channel in the communications foundation, subject to verification and preferences.

Reminder types under design: timed auction ending, outbid, event starting in 24 hours/1 hour/10 minutes, vehicle approaching in the run list, vehicle live now, event delayed/cancelled, and official win/settlement updates. The final default cadence requires Owner review. Reminders are not guarantees that a particular vehicle will begin at an exact minute.

## 7. Control your subscriptions

The planned experience separates Watch Listing, Follow Event, Follow Vehicle/Lot and Saved Search. You should be able to choose which reminders and channels you want, turn off a channel, change quiet hours and unsubscribe. A bid, a page view or a Facebook like must not automatically enroll you in unsolicited WhatsApp messages. Important account notices are separate from promotions; marketing must require consent.

If an event is postponed, scheduled reminders should be re-evaluated; a cancelled event should not keep sending start alerts. If a room is actually on air but your phone is offline, the alert can arrive late—always verify the current lot in the app before bidding.

## 8. Example messages (illustrative only)

Timed: “Your watched vehicle auction closes in one hour. See the latest time and bids.”

Outbid: “You are no longer the leading bidder. Review the current offer before deciding what to do.”

Event: “The live vehicle event you follow begins at 14:00 Africa/Harare. View the schedule.”

Lot: “The vehicle you follow is next in the run list. Timing may change.”

On air: “The vehicle you follow is LIVE BIDDING NOW. Enter the actual room.”

Change: “This event was delayed. Please check the updated schedule.”

These examples are not actual provider-approved message templates.

## 9. Safety and trust

Only the official item/room screen can submit a valid bid. Never send money, identity documents or your maximum proxy bid by responding to a social message. Check that notices use authentic Tengasell deep links. Your notification preferences should never reveal private bidder identities, full VIN/IMEI values or private reserves. If a link seems suspicious, return to the app and navigate to the event directly.

## 10. For event hosts and auctioneers

Authorized auctioneers and clerks operate events through the existing event/run-list and live-room consoles. They may open, progress, hammer/pass or close lots only when their account is granted the appropriate operation capability. Marketing a live event is distinct from issuing official bid-result notices; the first requires communication/campaign permission, and the second must originate from authoritative auction outcomes. An operator may not bypass a user's channel opt-out or invent a live status to attract visitors.

## 11. If something is missing

An empty Live Auction Events page should honestly state that no events are available. A missing notification channel should say Not available yet, not imply a sent message. A disconnected room should show Reconnecting and request a refreshed official state. Some described features remain proposed until the relevant implementation iteration has passed independent review and the Owner approves release.

## 12. Quick glossary

Auction: one timed commercial listing or bidding lot.

Auction Event: a scheduled hosted event that may contain several lots.

Live Session: the shared room attached to an auction event.

Current Lot: the one vehicle/item currently being offered in the live room.

Watch/Follow: a revocable interest/subscription, not a bid or purchase.

Bid qualification: the platform's authority check before accepting a bid.

Proxy bid: automatic bidding within a private maximum, under canonical auction rules.

Delivery status: proof that a channel accepted or delivered a notice; queueing alone is not delivery.

Guide status: R0 — Planned product experience / user orientation, not a claim that all described features are released.
