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
 *  Red LIVE BIDDING NOW is strictly gated on:
 *   1) LiveSession/event is actually live,
 *   2) canonical current lot exists,
 *   3) associated event/room/lot states are compatible,
 *   4) derived from authoritative data (no guessed or static live state). */
export function getLiveEventDisplay(input: {
  sessionStatus?: "scheduled" | "live" | "closed" | null
  eventStatus?: "DRAFT" | "SCHEDULED" | "LIVE" | "CLOSED" | "CANCELLED" | null
  currentLotId?: number | null
  lotStatus?: string | null
  lotLoaded?: boolean
  requireLotVerification?: boolean
}): LiveEventDisplay {
  const {
    sessionStatus = null,
    eventStatus = null,
    currentLotId = null,
    lotStatus = null,
    lotLoaded = false,
    requireLotVerification = true,
  } = input

  if (eventStatus === "CANCELLED") {
    return { state: "cancelled", label: "Event Cancelled", isAuthoritativeLive: false, ctaLabel: "View Event" }
  }
  if (eventStatus === "LIVE" && sessionStatus != null && sessionStatus !== "live") {
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

  const isSessionLive = sessionStatus === "live" || (sessionStatus == null && eventStatus === "LIVE")
  if (!isSessionLive) {
    return { state: "upcoming", label: "Upcoming Live Event", isAuthoritativeLive: false, ctaLabel: "Explore Live Events" }
  }

  if (eventStatus != null && eventStatus !== "LIVE") {
    return {
      state: "sync_mismatch",
      label: "Status temporarily unavailable",
      isAuthoritativeLive: false,
      ctaLabel: "View Live Room",
    }
  }

  if (currentLotId == null) {
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
    const normalizedLotStatus = String(lotStatus ?? "").toUpperCase()
    if (normalizedLotStatus !== "LIVE") {
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
