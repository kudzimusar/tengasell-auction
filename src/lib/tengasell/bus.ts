"use client";

// Tengasell event bus — unifies realtime updates from:
//   · socket.io broadcasts (live mode, trade engine on port 3002)
//   · local demo store mutations (offline fallback)
// Views subscribe once and refresh their data accordingly.

type EventMap = {
  "auction:update": { auction: import("./types").Auction };
  "auction:ended": { auction: import("./types").Auction };
  "message:new": { message: import("./types").Message };
  "notification:new": { notification: import("./types").Notification };
  "order:update": { order: import("./types").Order };
  "question:update": { question: import("./types").Question };
  "connection:changed": { connected: boolean };
};

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

const listeners: { [K in keyof EventMap]?: Set<Handler<K>> } = {};

export const bus = {
  on<K extends keyof EventMap>(event: K, handler: Handler<K>): () => void {
    // Cast through the generic keyed map — TS cannot prove the mapped-type
    // write for a generic K, but the runtime shape is exact.
    const map = listeners as Record<K, Set<Handler<K>> | undefined>;
    let set = map[event];
    if (!set) {
      set = new Set<Handler<K>>();
      map[event] = set;
    }
    set.add(handler);
    return () => set.delete(handler);
  },
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const map = listeners as Record<K, Set<Handler<K>> | undefined>;
    map[event]?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error("[bus] handler error", err);
      }
    });
  },
};

export type BusEvent = keyof EventMap;
