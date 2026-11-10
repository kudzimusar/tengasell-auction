// MOB-03 — live bidding transport.
//
// Commercial writes go through the Socket.IO trade engine on :3002, exactly as
// the web client does (gateway + ?XTransformPort). The record API is read-only
// for bids: IMP-01 moved auction authority here, and this client must not
// attempt a direct record write.

import { io, type Socket } from "socket.io-client";

import { getCanonicalBaseUrl } from "./trailbase";

let socket: Socket | null = null;

export function connectBidding(token: string | null): Socket {
  const base = getCanonicalBaseUrl();
  if (!base) throw new Error("Canonical API is not configured.");
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socket = io(`${base}/?XTransformPort=3002`, {
    transports: ["websocket", "polling"],
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 8000,
  });
  return socket;
}

export function getBiddingSocket(): Socket | null {
  return socket;
}

export function disconnectBidding(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export interface BidOutcome {
  ok: boolean;
  amount?: number;
  error?: string;
  /** True when the engine's standing auto-bid immediately covered this bid. */
  outbid?: boolean;
  /** True when the bidder is now the leading bidder. */
  winning?: boolean;
}

/** Place a proxy bid; resolves with the engine's ack or a timeout. */
export function placeBid(auctionId: number, maxAmount: number, timeoutMs = 9000): Promise<BidOutcome> {
  return new Promise((resolve) => {
    const s = socket;
    if (!s || !s.connected) {
      resolve({ ok: false, error: "Not connected to the live auction engine." });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "The auction engine did not respond. Please retry." });
    }, timeoutMs);

    s.emit("bid:place", { auctionId, maxAmount }, (res: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const payload = (res ?? {}) as {
        ok?: boolean;
        amount?: number;
        error?: string;
        outbid?: boolean;
        winning?: boolean;
      };
      resolve({
        ok: Boolean(payload.ok),
        amount: payload.amount,
        error: payload.error,
        outbid: payload.outbid,
        winning: payload.winning,
      });
    });
  });
}
