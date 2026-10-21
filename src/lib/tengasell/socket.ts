"use client";

// Tengasell socket client — talks to the trade engine (port 3002) through the
// gateway: io("/?XTransformPort=3002"). All trading writes go through RPC
// events validated server-side (proxy bidding, anti-snipe, SLA orders).

import { io, type Socket } from "socket.io-client";
import { bus } from "./bus";

let socket: Socket | null = null;
let currentToken: string | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}

export function connectSocket(token: string | null): Promise<Socket | null> {
  disconnectSocket();
  currentToken = token ?? null;
  return new Promise((resolve) => {
    try {
      const s = io("/?XTransformPort=3002", {
        auth: token ? { token } : {},
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        timeout: 8000,
      });
      socket = s;

      s.on("connect", () => {
        bus.emit("connection:changed", { connected: true });
        resolve(s);
      });
      s.on("disconnect", () => {
        bus.emit("connection:changed", { connected: false });
      });
      s.on("connect_error", () => {
        bus.emit("connection:changed", { connected: false });
        resolve(null);
      });

      // broadcasts → bus
      s.on("auction:update", (p) => bus.emit("auction:update", { auction: p?.auction }));
      s.on("auction:ended", (p) => bus.emit("auction:ended", { auction: p?.auction }));
      s.on("message:new", (p) => bus.emit("message:new", { message: p?.message }));
      s.on("notification:new", (p) => bus.emit("notification:new", { notification: p?.notification }));
      s.on("order:update", (p) => bus.emit("order:update", { order: p?.order }));
      s.on("question:update", (p) => bus.emit("question:update", { question: p?.question }));
      // Gap-8: engine offer broadcasts → bus. The shared bus EventMap predates
      // this event (bus.ts is orchestrator-owned), so emit through a widened
      // shim; payload shape is the engine's { auctionId, offer }.
      s.on("offer:update", (p) => (bus as unknown as { emit: (e: string, p: unknown) => void }).emit("offer:update", p));
      // Gap-8 F3: live-room broadcasts → bus. Same widened-shim pattern as
      // offer:update above (bus EventMap predates the event); payload is the
      // engine's { session }.
      s.on("room:update", (p) => (bus as unknown as { emit: (e: string, p: unknown) => void }).emit("room:update", p));
    } catch {
      resolve(null);
    }
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    bus.emit("connection:changed", { connected: false });
  }
}

/** RPC with ack + timeout. Throws Error(message) on failure. */
export function rpc<T = unknown>(
  event: string,
  data: Record<string, unknown>,
  timeoutMs = 12_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = socket;
    if (!s || !s.connected) {
      reject(new Error("Trade engine offline — real-time trading is unavailable."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The trade engine did not respond in time. Please retry."));
      }
    }, timeoutMs);
    s.emit(event, data, (res: { ok?: boolean; error?: string } & Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res && res.ok === false) {
        reject(new Error(res.error || "Request failed."));
      } else {
        resolve(res as T);
      }
    });
  });
}
