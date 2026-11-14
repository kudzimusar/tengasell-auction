import type { Auction } from "@/lib/tengasell/types"

export type TimedDisplayState =
  | "open"
  | "closing_soon"
  | "ended"
  | "sold"
  | "cancelled"
  | "draft"

export interface TimedAuctionDisplay {
  state: TimedDisplayState
  label: string
  endingSoon: boolean
  remainingMs: number
}

/** Derive customer-facing status for individual timed auctions (never emits a red LIVE room indicator). */
export function getTimedAuctionDisplay(
  auction: Pick<Auction, "status" | "ends_at">,
  nowMs = Date.now(),
): TimedAuctionDisplay {
  const remainingMs = Date.parse(auction.ends_at) - nowMs
  if (auction.status === "sold") {
    return { state: "sold", label: "Sold", endingSoon: false, remainingMs }
  }
  if (auction.status === "cancelled") {
    return { state: "cancelled", label: "Auction Ended", endingSoon: false, remainingMs }
  }
  if (auction.status === "draft") {
    return { state: "draft", label: "Draft", endingSoon: false, remainingMs }
  }
  if (auction.status === "ended" || !Number.isFinite(remainingMs) || remainingMs <= 0) {
    return {
      state: "ended",
      label: "Auction Ended",
      endingSoon: false,
      remainingMs: Number.isFinite(remainingMs) ? remainingMs : 0,
    }
  }
  if (remainingMs < 3600_000) {
    return { state: "closing_soon", label: "Closing Soon", endingSoon: true, remainingMs }
  }
  return { state: "open", label: "Open for Bids", endingSoon: false, remainingMs }
}

export type LiveEventDisplayState =
  | "live_bidding"
  | "awaiting_lot"
  | "upcoming"
  | "completed"
  | "cancelled"
  | "sync_mismatch"
  | "checking"

export interface LiveEventDisplay {
  state: LiveEventDisplayState
  label: string
  isAuthoritativeLive: boolean
  ctaLabel: string
}

/** Derive Live Auction Event / Room state from authoritative sources.
 *  Red LIVE BIDDING NOW is strictly gated on all invariants:
 *   1) Actual LiveSession exists and sessionStatus === "live",
 *   2) If event-backed, eventStatus === "LIVE" and session-event linkage matches,
 *   3) Session has a valid non-null currentLotId (and compatible eventCurrentLotId),
 *   4) Required session/event/lot data are loaded and not stale/errored/reconnecting,
 *   5) Authoritative AuctionLot status (when event-backed) is "LIVE",
 *   6) Underlying Auction status is "live" (not sold/ended/cancelled/draft). */
export interface LiveEventDisplayInput {
  sessionStatus?: "scheduled" | "live" | "closed" | null
  sessionExists?: boolean
  sessionLoaded?: boolean
  eventStatus?: "DRAFT" | "SCHEDULED" | "LIVE" | "CLOSED" | "CANCELLED" | null
  eventBacked?: boolean
  eventLoaded?: boolean
  sessionMatchesEvent?: boolean
  currentLotId?: number | null
  eventCurrentLotId?: number | null
  lotMatchesSession?: boolean
  eventLotStatus?: string | null
  lotAuctionStatus?: string | null
  lotStatus?: string | null
  lotLoaded?: boolean
  reconnecting?: boolean
  stale?: boolean
  dataError?: boolean
  requireLotVerification?: boolean
}

export function getLiveEventDisplay(input: LiveEventDisplayInput): LiveEventDisplay {
  const {
    sessionStatus = null,
    sessionExists = sessionStatus != null,
    sessionLoaded = true,
    eventStatus = null,
    eventBacked = eventStatus != null,
    eventLoaded = true,
    sessionMatchesEvent = true,
    currentLotId = null,
    eventCurrentLotId,
    lotMatchesSession = true,
    eventLotStatus = null,
    lotAuctionStatus = null,
    lotStatus = null,
    lotLoaded = false,
    reconnecting = false,
    stale = false,
    dataError = false,
    requireLotVerification = true,
  } = input

  if (eventStatus === "CANCELLED") {
    return { state: "cancelled", label: "Event Cancelled", isAuthoritativeLive: false, ctaLabel: "View Event" }
  }
  if (dataError) {
    return {
      state: "sync_mismatch",
      label: "Status temporarily unavailable",
      isAuthoritativeLive: false,
      ctaLabel: "View Live Room",
    }
  }
  if (eventStatus === "LIVE" && (!sessionExists || sessionStatus == null)) {
    if (!sessionLoaded) {
      return {
        state: "checking",
        label: "Verifying Live State",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    return {
      state: "sync_mismatch",
      label: "Status temporarily unavailable",
      isAuthoritativeLive: false,
      ctaLabel: "View Live Room",
    }
  }
  if (eventStatus === "LIVE" && sessionStatus !== "live") {
    return {
      state: "sync_mismatch",
      label: "Status temporarily unavailable",
      isAuthoritativeLive: false,
      ctaLabel: "View Live Room",
    }
  }
  if (sessionStatus === "closed" || (sessionStatus == null && eventStatus === "CLOSED")) {
    return { state: "completed", label: "Event Completed", isAuthoritativeLive: false, ctaLabel: "View Summary" }
  }
  if (
    sessionStatus === "scheduled" ||
    (sessionStatus == null && (eventStatus === "SCHEDULED" || eventStatus === "DRAFT"))
  ) {
    return { state: "upcoming", label: "Upcoming Live Event", isAuthoritativeLive: false, ctaLabel: "Explore Live Events" }
  }

  if (!sessionExists || sessionStatus !== "live") {
    return { state: "upcoming", label: "Upcoming Live Event", isAuthoritativeLive: false, ctaLabel: "Explore Live Events" }
  }

  if (eventBacked) {
    if (!eventLoaded) {
      return {
        state: "checking",
        label: "Verifying Live State",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    if (eventStatus !== "LIVE" || !sessionMatchesEvent) {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
  }

  if (reconnecting || stale) {
    return {
      state: "checking",
      label: "Reconnecting to Live Floor",
      isAuthoritativeLive: false,
      ctaLabel: "View Live Room",
    }
  }

  if (currentLotId == null) {
    if (eventBacked && eventCurrentLotId != null) {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    return {
      state: "awaiting_lot",
      label: "Room Open — Awaiting Next Lot",
      isAuthoritativeLive: false,
      ctaLabel: "Enter Live Room",
    }
  }

  if (requireLotVerification) {
    if (!lotLoaded) {
      return {
        state: "checking",
        label: "Room Open — Checking Current Lot",
        isAuthoritativeLive: false,
        ctaLabel: "Enter Live Room",
      }
    }
    if (!lotMatchesSession) {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    if (eventBacked && eventCurrentLotId === null) {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    if (eventLotStatus != null && String(eventLotStatus).toUpperCase() !== "LIVE") {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    if (lotAuctionStatus != null && String(lotAuctionStatus).toLowerCase() !== "live") {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
    if (lotStatus != null) {
      const normalizedLotStatus = String(lotStatus).toUpperCase()
      if (normalizedLotStatus !== "LIVE") {
        return {
          state: "sync_mismatch",
          label: "Status temporarily unavailable",
          isAuthoritativeLive: false,
          ctaLabel: "View Live Room",
        }
      }
    } else if (eventLotStatus == null && lotAuctionStatus == null) {
      return {
        state: "sync_mismatch",
        label: "Status temporarily unavailable",
        isAuthoritativeLive: false,
        ctaLabel: "View Live Room",
      }
    }
  }

  return {
    state: "live_bidding",
    label: "Live Bidding Now",
    isAuthoritativeLive: true,
    ctaLabel: "Enter Live Room",
  }
}

export type ItemAuctionMode =
  | "standalone_timed"
  | "live_event_scheduled"
  | "live_floor_active"
  | "live_event_concluded"
  | "returned_to_timed"

export interface ItemAuctionModePresentation {
  mode: ItemAuctionMode
  badgeLabel: string
  bannerTitle: string | null
  bannerBody: string | null
  primaryActionLabel: string | null
  primaryActionHref: string | null
  isStandaloneTimed: boolean
  isOnLiveFloor: boolean
  allowTimedBidding: boolean
}

export function getItemAuctionModePresentation(input: {
  auction: Pick<Auction, "id" | "status" | "ends_at" | "live_session_id">
  session?: {
    id: number
    status: "scheduled" | "live" | "closed"
    current_lot_id?: number | null
    event_id?: number | null
    title?: string
  } | null
  sessionLoaded?: boolean
  event?: {
    id: number
    session_id?: number | null
    status: "DRAFT" | "SCHEDULED" | "LIVE" | "CLOSED" | "CANCELLED"
    current_lot_id?: number | null
    title?: string
  } | null
  eventLoaded?: boolean
  lot?: {
    id: number
    auction_id: number
    status: string
  } | null
  nowMs?: number
}): ItemAuctionModePresentation {
  const {
    auction,
    session = null,
    sessionLoaded = auction.live_session_id == null,
    event = null,
    eventLoaded = true,
    lot = null,
    nowMs = Date.now(),
  } = input

  if (auction.live_session_id == null && !lot) {
    return {
      mode: "standalone_timed",
      badgeLabel: "Timed Auction",
      bannerTitle: null,
      bannerBody: null,
      primaryActionLabel: null,
      primaryActionHref: null,
      isStandaloneTimed: true,
      isOnLiveFloor: false,
      allowTimedBidding: auction.status === "live",
    }
  }

  const eventHref = event ? `#/events/${event.id}` : session?.event_id ? `#/events/${session.event_id}` : null
  const roomHref = auction.live_session_id != null ? `#/live/${auction.live_session_id}` : eventHref

  if (lot?.status === "WITHDRAWN" && auction.status === "live" && Date.parse(auction.ends_at) > nowMs) {
    return {
      mode: "returned_to_timed",
      badgeLabel: "Returned to Timed Auction",
      bannerTitle: "Returned to Timed Auction",
      bannerBody: "This listing was withdrawn from the live event run list and is active under timed auction rules.",
      primaryActionLabel: eventHref ? "View Event History" : null,
      primaryActionHref: eventHref,
      isStandaloneTimed: false,
      isOnLiveFloor: false,
      allowTimedBidding: true,
    }
  }

  const eventBacked = session?.event_id != null || event != null
  const isCurrentSessionLot = session != null && session.current_lot_id === auction.id
  const lotDisplay = getLiveEventDisplay({
    sessionStatus: session?.status ?? null,
    sessionExists: session != null,
    sessionLoaded,
    eventBacked,
    eventStatus: event?.status ?? null,
    eventLoaded,
    sessionMatchesEvent:
      !eventBacked ||
      !session ||
      !event ||
      (event.session_id == null || Number(event.session_id) === Number(session.id)),
    currentLotId: session?.current_lot_id ?? null,
    eventCurrentLotId: event ? event.current_lot_id : undefined,
    lotMatchesSession: isCurrentSessionLot && (!lot || lot.auction_id === auction.id),
    eventLotStatus: lot?.status ?? null,
    lotAuctionStatus: auction.status,
    lotStatus: auction.status === "live" ? "LIVE" : auction.status,
    lotLoaded: Boolean(sessionLoaded && (!eventBacked || (eventLoaded && lot != null))),
    requireLotVerification: true,
  })

  if (isCurrentSessionLot && lotDisplay.isAuthoritativeLive) {
    return {
      mode: "live_floor_active",
      badgeLabel: "Live Bidding Now · ON AIR",
      bannerTitle: "Currently on the Live Auction Floor",
      bannerBody: "Bidding for this vehicle is active inside the synchronized live auction room.",
      primaryActionLabel: "Enter Live Room",
      primaryActionHref: roomHref,
      isStandaloneTimed: false,
      isOnLiveFloor: true,
      allowTimedBidding: false,
    }
  }

  const concludedInLiveEvent =
    lot?.status === "SOLD" ||
    lot?.status === "PASSED" ||
    auction.status === "sold" ||
    auction.status === "ended" ||
    auction.status === "cancelled" ||
    session?.status === "closed" ||
    event?.status === "CLOSED" ||
    event?.status === "CANCELLED"

  if (concludedInLiveEvent) {
    const sold = auction.status === "sold" || lot?.status === "SOLD"
    return {
      mode: "live_event_concluded",
      badgeLabel: sold ? "Sold in Live Event" : "Live-Room Auction Concluded",
      bannerTitle: sold ? "Sold in Live Auction Event" : "Live-Room Auction Concluded",
      bannerBody: sold
        ? "This vehicle sold during its assigned live auction event."
        : "The live auction event for this vehicle has concluded.",
      primaryActionLabel: roomHref ? (eventHref ? "View Event Summary" : "View Live Room Summary") : null,
      primaryActionHref: eventHref ?? roomHref,
      isStandaloneTimed: false,
      isOnLiveFloor: false,
      allowTimedBidding: false,
    }
  }

  return {
    mode: "live_event_scheduled",
    badgeLabel: "Scheduled for Live Auction Event",
    bannerTitle: session?.status === "live"
      ? "Scheduled for Live Auction Event · Queued in Run List"
      : "Scheduled for Live Auction Event",
    bannerBody: "This vehicle is assigned to a live auction event rather than closing as an independent timed listing.",
    primaryActionLabel: session?.status === "live" ? "View Live Room" : eventHref ? "View Live Event" : "View Live Room",
    primaryActionHref: session?.status === "live" ? roomHref : (eventHref ?? roomHref),
    isStandaloneTimed: false,
    isOnLiveFloor: false,
    allowTimedBidding: false,
  }
}
