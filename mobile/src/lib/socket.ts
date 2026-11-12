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

export interface ConnectBiddingOptions {
  /** Dynamic token supplier for reconnects after token rotation or expiry. */
  getToken?: () => Promise<string | null> | string | null;
  /** Called when the trade engine emits `auth:revoked` and disconnects this session. */
  onAuthRevoked?: (payload: { code: string; error?: string }) => void;
  /** Called when Socket.IO encounters a connection handshake or transport error. */
  onConnectError?: (error: Error) => void;
}

export interface PlaceBidOptions {
  timeoutMs?: number;
  clientRequestId?: string;
}

export function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `mob-${globalThis.crypto.randomUUID()}`;
  }
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function connectBidding(
  token: string | null,
  options?: ConnectBiddingOptions,
): Socket {
  const base = getCanonicalBaseUrl();
  if (!base) throw new Error("Canonical API is not configured.");
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  const attempt = ownership.next();
  let latestToken = token;
  const attemptSocket = io(`${base}/?XTransformPort=3002`, {
    forceNew: true,
    transports: ["websocket", "polling"],
    auth: (cb) => {
      if (!options?.getToken) {
        cb(latestToken ? { token: latestToken } : {});
        return;
      }
      void Promise.resolve(options.getToken())
        .then((fresh) => {
          if (!ownership.isCurrent(attempt)) {
            cb({});
            return;
          }
          latestToken = fresh ?? null;
          cb(latestToken ? { token: latestToken } : {});
        })
        .catch(() => {
          cb({});
        });
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 8000,
  });
  socket = attemptSocket;

  // A completion that arrives after logout/account-switch/unmount must not
  // resurrect bidding capability for a session that no longer owns it. Dispose
  // THIS attempt's socket: a newer attempt may already own the module slot, and
  // tearing that one down would close a valid connection.
  attemptSocket.on("connect", () => {
    if (ownership.isCurrent(attempt)) return;
    attemptSocket.removeAllListeners();
    attemptSocket.disconnect();
    if (socket === attemptSocket) socket = null;
  });

  attemptSocket.on("auth:revoked", (payload: { code?: unknown; error?: unknown } | undefined) => {
    if (!ownership.isCurrent(attempt)) return;
    disconnectBidding();
    options?.onAuthRevoked?.({
      code: typeof payload?.code === "string" && payload.code ? payload.code : "AUTH_REVOKED",
      error: typeof payload?.error === "string" ? payload.error : undefined,
    });
  });

  attemptSocket.on("connect_error", (error: Error) => {
    if (!ownership.isCurrent(attempt)) return;
    options?.onConnectError?.(error);
  });

  return attemptSocket;
}

export function getBiddingSocket(): Socket | null {
  return socket;
}

export function disconnectBidding(expectedAttempt?: number): void {
  if (expectedAttempt !== undefined && !ownership.isCurrent(expectedAttempt)) {
    return;
  }
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

/** Place a proxy bid; resolves with the engine's ack or an uncertain outcome. */
export function placeBid(
  auctionId: number,
  maxAmount: number,
  timeoutOrOptions: number | PlaceBidOptions = 9000,
): Promise<BidOutcome> {
  const timeoutMs =
    typeof timeoutOrOptions === "number" ? timeoutOrOptions : (timeoutOrOptions.timeoutMs ?? 9000);
  const clientRequestId =
    typeof timeoutOrOptions === "number"
      ? createClientRequestId()
      : (timeoutOrOptions.clientRequestId ?? createClientRequestId());

  return new Promise((resolve) => {
    const s = socket;
    if (!s || !s.connected) {
      // Nothing was emitted on the transport; safe authoritative pre-commit refusal.
      resolve({
        ok: false,
        rejected: true,
        stage: "pre_commit",
        errorCode: "NOT_CONNECTED",
      });
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
      });
    }, timeoutMs);

    // Losing the socket before the ack is also not a rejection.
    const onDisconnect = () => {
      finish({
        ok: false,
        uncertain: true,
        reason: "disconnected",
      });
    };
    s.once("disconnect", onDisconnect);
    const offDisconnect = () => {
      s.off("disconnect", onDisconnect);
    };

    s.emit("bid:place", { auctionId, maxAmount, clientRequestId }, (res: unknown) => {
      finish(parseBidAck(res));
    });
  });
}
