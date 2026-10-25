/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  createAuctionEvent,
  eventCreateAuthorization,
  type EventIdentity,
  type EventStore,
} from "./event-authority";

class EventMemoryStore implements EventStore {
  private seq = 100;
  rows: Record<string, any[]> = {
    auction_venues: [],
    auction_events: [],
    live_sessions: [],
    auction_event_operators: [],
  };

  async create(table: string, row: any) {
    const id = ++this.seq;
    this.rows[table] ??= [];
    const saved = { id, ...row };
    this.rows[table].push(saved);

    // Mirrors the U10 database creation trigger closely enough to prove that
    // only an already-authorized creator can ever reach HOST bootstrap.
    if (table === "auction_events") {
      const sessionId = ++this.seq;
      this.rows.live_sessions.push({
        id: sessionId,
        event_id: id,
        host_user: row.host_user,
        host_username: row.host_username,
        title: row.title,
        status: "scheduled",
        run_list_version: 0,
        run_list_locked: 0,
      });
      saved.session_id = sessionId;
      this.rows.auction_event_operators.push({
        id: ++this.seq,
        event_id: id,
        user: row.host_user,
        username: row.host_username,
        role: "HOST",
        active: 1,
        granted_by: row.host_user,
      });
    }
    return id;
  }

  async get(table: string, id: number | string) {
    return (this.rows[table] ?? []).find((row) => String(row.id) === String(id)) ?? null;
  }

  async list(table: string, query: string) {
    let rows = [...(this.rows[table] ?? [])];
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      const match = key.match(/^filter\[([^\]]+)\]\[\$eq\]$/);
      if (match) rows = rows.filter((row) => String(row[match[1]!]) === value);
    }
    return rows.slice(0, Number(params.get("limit") ?? rows.length));
  }

  async update(table: string, id: number | string, patch: any) {
    const row = (this.rows[table] ?? []).find((candidate) => String(candidate.id) === String(id));
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
}

const ordinary: EventIdentity = { id: "ordinary-user", username: "buyer1", admin: false };
const admin: EventIdentity = { id: "admin-user", username: "auction-admin", admin: true };
const audit = async () => {};

test("ordinary authenticated user cannot create an event or bootstrap HOST", async () => {
  const store = new EventMemoryStore();
  expect(eventCreateAuthorization(ordinary)).toMatchObject({
    allowed: false,
    authority: "NONE",
    code: "EVENT_CREATE_FORBIDDEN",
  });

  const result = await createAuctionEvent(store, audit, ordinary, { title: "Forbidden event" });
  expect(result.ok).toBe(false);
  expect(result.code).toBe("EVENT_CREATE_FORBIDDEN");
  expect(result.error).toContain("Administrator permission");
  expect(store.rows.auction_events).toHaveLength(0);
  expect(store.rows.live_sessions).toHaveLength(0);
  expect(store.rows.auction_event_operators.filter((row) => row.role === "HOST")).toHaveLength(0);
});

test("authorized administrator creates event and receives the triggered HOST authority", async () => {
  const store = new EventMemoryStore();
  expect(eventCreateAuthorization(admin)).toMatchObject({
    allowed: true,
    authority: "ADMIN",
    code: null,
  });

  const result = await createAuctionEvent(store, audit, admin, {
    title: "Harare Saturday Vehicle Auction",
    startsAt: "2026-11-07T08:00:00Z",
    venue: { name: "Tengasell Auction Centre", city: "Harare", country: "Zimbabwe" },
  });

  expect(result.ok).toBe(true);
  expect(result.event?.host_user).toBe(admin.id);
  expect(result.session?.event_id).toBe(result.event?.id);
  expect(store.rows.auction_event_operators).toContainEqual(
    expect.objectContaining({
      event_id: result.event?.id,
      user: admin.id,
      username: admin.username,
      role: "HOST",
      active: 1,
    }),
  );
});

test("service-level gate prevents a direct transport caller from creating then becoming HOST", async () => {
  const store = new EventMemoryStore();
  const directTransportAttempt = await createAuctionEvent(store, audit, ordinary, {
    title: "Direct socket bootstrap attempt",
    timezone: "Africa/Harare",
  });

  expect(directTransportAttempt).toMatchObject({
    ok: false,
    code: "EVENT_CREATE_FORBIDDEN",
  });
  expect(store.rows.auction_events).toHaveLength(0);
  expect(store.rows.auction_event_operators).toHaveLength(0);
});
