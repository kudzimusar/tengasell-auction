// MOB-03 — live bidding transport.
//
// Commercial writes go through the Socket.IO trade engine on :3002, exactly as
// the web client does (gateway + ?XTransformPort). The record API is read-only
// for bids: IMP-01 moved auction authority here, and this client must not
// attempt a direct record write.

import { io, type Socket } from "socket.io-client";

import { getCanonicalBaseUrl } from "./trailbase";
import { ConnectionEpoch } from "./connection-epoch";
import { parseBidAck, type BidOutcome } from "./bid-ack";

let socket: Socket | null = null;
const ownership = new ConnectionEpoch();

export function connectBidding(token: string | null): Socket {
  const base = getCanonicalBaseUrl();
  if (!base) throw new Error("Canonical API is not configured.");
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  const attempt = ownership.next();
  socket = io(`${base}/?XTransformPort=3002`, {
    transports: ["websocket", "polling"],
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 8000,
  });
  // A completion that arrives after logout/account-switch/unmount must not
  // resurrect bidding capability for a session that no longer owns it.
  socket.on("connect", () => {
    if (ownership.isCurrent(attempt)) return;
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
  });

  return socket;
}

export function getBiddingSocket(): Socket | null {
  return socket;
}

export function disconnectBidding(): void {
  ownership.invalidate();
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export type { BidOutcome } from "./bid-ack";

/** Ownership token for the live connection; see ConnectionEpoch. */
export function biddingOwnershipToken(): number {
  return ownership.current();
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
    const finish = (outcome: BidOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offDisconnect();
      resolve(outcome);
    };

    // A timeout is not a rejection: the command may already be at the engine.
    const timer = setTimeout(() => {
      finish({
        ok: false,
        uncertain: true,
        reason: "timeout",
        error: "The auction engine did not respond.",
      });
    }, timeoutMs);

    // Losing the socket before the ack is also not a rejection.
    const onDisconnect = () => {
      finish({
        ok: false,
        uncertain: true,
        reason: "disconnected",
        error: "The connection to the auction engine was lost.",
      });
    };
    s.once("disconnect", onDisconnect);
    const offDisconnect = () => {
      s.off("disconnect", onDisconnect);
    };

    s.emit("bid:place", { auctionId, maxAmount }, (res: unknown) => {
      finish(parseBidAck(res));
    });
  });
}
