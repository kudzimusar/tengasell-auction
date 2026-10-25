// IMP-05 Event / Session / Run-List server authority.
// Ordering correctness lives in the SQLite command trigger; this module is the
// authenticated transport/idempotency adapter used by the existing trade engine.

import { randomUUID } from "node:crypto";

export interface EventIdentity {
  id: string;
  username: string;
  admin?: boolean;
}

export interface EventStore {
  create(table: string, row: unknown): Promise<number | null>;
  get(table: string, id: number | string): Promise<any | null>;
  list(table: string, params: string): Promise<any[]>;
  update(table: string, id: number | string, patch: unknown): Promise<boolean>;
}

export type RunListCommandType =
  | "ADD"
  | "MOVE"
  | "WITHDRAW"
  | "LOCK"
  | "UNLOCK"
  | "OPEN"
  | "CLOSE"
  | "END";

export interface RunListResult {
  ok: boolean;
  error?: string;
  code?: string;
  replayed: boolean;
  commandKey: string;
  session?: any;
  command?: any;
  lot?: any;
  runList?: any[];
}

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

const clean = (value: unknown, max = 240) =>
  String(value ?? "").trim().slice(0, max);

function query(fields: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) q.set(k, String(v));
  return q.toString();
}

function commandKey(value: unknown, prefix: string) {
  const raw = clean(value, 160);
  if (raw && /^[A-Za-z0-9._:-]+$/.test(raw)) return raw;
  return `${prefix}:${randomUUID()}`;
}

const ERRORS: Record<string, string> = {
  SESSION_NOT_FOUND: "Live session not found.",
  EVENT_REQUIRED: "This session is not attached to an Auction Event.",
  OPERATOR_FORBIDDEN: "Only the session operator or an administrator can change the run list.",
  STALE_RUN_LIST_VERSION: "The run list changed before this action committed. Refresh and retry.",
  SESSION_CLOSED: "This live session is already closed.",
  RUN_LIST_LOCKED: "The run list is locked.",
  RUN_LIST_ALREADY_LOCKED: "The run list is already locked.",
  RUN_LIST_ALREADY_UNLOCKED: "The run list is already unlocked.",
  LIVE_RUN_LIST_CANNOT_UNLOCK: "A live run list cannot be unlocked.",
  AUCTION_NOT_FOUND: "Auction not found.",
  LOT_NOT_READY: "This auction is not ready to enter or open in the run list.",
  LOT_ALREADY_ASSIGNED: "This auction is already assigned to an event lot.",
  VEHICLE_NOT_ELIGIBLE: "This vehicle is not currently eligible for auction.",
  INVALID_SEQUENCE: "That run-list position is invalid.",
  LOT_NOT_FOUND: "Auction lot not found.",
  LOT_NOT_REORDERABLE: "Only a ready lot can be reordered.",
  LOT_NOT_WITHDRAWABLE: "Only a ready lot can be withdrawn.",
  WITHDRAW_REASON_REQUIRED: "Give a withdrawal reason of at least five characters.",
  RUN_LIST_MUST_BE_LOCKED: "Lock the production run list before opening a lot.",
  CURRENT_LOT_ACTIVE: "Finish the current lot before this action.",
  OUT_OF_SEQUENCE: "The first ready lot must open next.",
  CURRENT_LOT_MISMATCH: "The requested lot is not the current live lot.",
  AUCTION_NOT_FINALIZED: "Finalize the auction outcome before closing its run-list lot.",
  IDEMPOTENCY_KEY_REUSE: "That operator command id was already used for a different action.",
};

async function existingCommand(store: EventStore, key: string) {
  const rows = await store.list(
    "auction_runlist_commands",
    `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function runListBundle(store: EventStore, sessionId: number) {
  const session = await store.get("live_sessions", sessionId);
  if (!session) return { session: null, event: null, venue: null, lots: [] };

  const [event, lots] = await Promise.all([
    session.event_id == null ? Promise.resolve(null) : store.get("auction_events", Number(session.event_id)),
    store.list(
      "auction_lots",
      `filter[session_id][$eq]=${sessionId}&order=sequence_no&limit=500`,
    ),
  ]);
  const venue =
    event?.venue_id == null ? null : await store.get("auction_venues", Number(event.venue_id));

  const auctions = await Promise.all(
    lots.map((lot) => store.get("auctions", Number(lot.auction_id))),
  );
  return {
    session,
    event,
    venue,
    lots: lots.map((lot, index) => ({ ...lot, auction: auctions[index] ?? null })),
  };
}

export async function submitRunListCommand(
  store: EventStore,
  me: EventIdentity,
  input: {
    commandKey?: string | null;
    sessionId: number;
    commandType: RunListCommandType;
    expectedVersion: number;
    auctionId?: number | null;
    lotId?: number | null;
    targetSequence?: number | null;
    reason?: string | null;
  },
): Promise<RunListResult> {
  const key = commandKey(
    input.commandKey,
    `runlist:${input.commandType.toLowerCase()}:${input.sessionId}`,
  );

  if (
    !Number.isSafeInteger(input.sessionId) ||
    input.sessionId <= 0 ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    return { ok: false, error: "Invalid run-list command.", code: "INVALID_COMMAND", replayed: false, commandKey: key };
  }

  let command = await existingCommand(store, key);
  let replayed = command != null;
  if (command) {
    const mismatch =
      Number(command.session_id) !== input.sessionId ||
      String(command.actor_user) !== String(me.id) ||
      String(command.command_type) !== input.commandType ||
      Number(command.expected_version) !== input.expectedVersion ||
      Number(command.auction_id ?? 0) !== Number(input.auctionId ?? 0) ||
      Number(command.lot_id ?? 0) !== Number(input.lotId ?? 0) ||
      Number(command.target_sequence ?? 0) !== Number(input.targetSequence ?? 0) ||
      String(command.reason ?? "") !== clean(input.reason);
    if (mismatch) {
      return {
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSE",
        error: ERRORS.IDEMPOTENCY_KEY_REUSE,
        replayed: true,
        commandKey: key,
      };
    }
  } else {
    const id = await store.create("auction_runlist_commands", {
      command_key: key,
      session_id: input.sessionId,
      actor_user: me.id,
      actor_username: me.username,
      actor_admin: me.admin ? 1 : 0,
      command_type: input.commandType,
      auction_id: input.auctionId ?? null,
      lot_id: input.lotId ?? null,
      target_sequence: input.targetSequence ?? null,
      expected_version: input.expectedVersion,
      reason: clean(input.reason) || null,
    });
    command = id != null
      ? await store.get("auction_runlist_commands", id)
      : await existingCommand(store, key);
    replayed = id == null && command != null;
  }

  if (!command) {
    return {
      ok: false,
      code: "COMMAND_PERSIST_FAILED",
      error: "The run-list command could not be persisted.",
      replayed,
      commandKey: key,
    };
  }
  if (command.status !== "accepted") {
    const code = String(command.error_code ?? "COMMAND_REJECTED");
    return {
      ok: false,
      code,
      error: ERRORS[code] ?? "The run-list command was rejected.",
      replayed,
      commandKey: key,
      command,
    };
  }

  const bundle = await runListBundle(store, input.sessionId);
  const lotId = command.result_lot_id ?? input.lotId ?? null;
  return {
    ok: true,
    replayed,
    commandKey: key,
    command,
    session: bundle.session,
    lot: lotId == null ? null : bundle.lots.find((l) => Number(l.id) === Number(lotId)) ?? null,
    runList: bundle.lots,
  };
}

export async function createAuctionEventSession(
  store: EventStore,
  me: EventIdentity,
  input: {
    title: string;
    description?: string | null;
    scheduledAt: string;
    endsAt?: string | null;
    timezone?: string | null;
    venueId?: number | null;
  },
) {
  const title = clean(input.title, 160);
  const scheduled = new Date(input.scheduledAt);
  if (title.length < 3 || Number.isNaN(scheduled.getTime())) {
    return { ok: false, error: "Event title and schedule are required." };
  }
  const end = input.endsAt ? new Date(input.endsAt) : new Date(scheduled.getTime() + 4 * 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end <= scheduled) {
    return { ok: false, error: "Event end must be after its start." };
  }
  if (input.venueId != null && !(await store.get("auction_venues", input.venueId))) {
    return { ok: false, error: "Auction venue not found." };
  }

  const code = `EVT-${scheduled.toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,8).toUpperCase()}`;
  const eventId = await store.create("auction_events", {
    code,
    title,
    description: clean(input.description, 1200),
    venue_id: input.venueId ?? null,
    starts_at: scheduled.toISOString(),
    ends_at: end.toISOString(),
    timezone: clean(input.timezone || "Africa/Harare", 80),
    status: "PUBLISHED",
    organizer_user: me.id,
    organizer_username: me.username,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (eventId == null) return { ok: false, error: "Auction Event could not be created." };

  const sessionId = await store.create("live_sessions", {
    host_user: me.id,
    host_username: me.username,
    title,
    scheduled_at: scheduled.toISOString(),
    status: "scheduled",
    current_lot_id: null,
    lot_index: 0,
    close_at: null,
    event_id: eventId,
    run_list_version: 0,
    run_list_locked: 0,
    current_auction_lot_id: null,
    next_auction_lot_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (sessionId == null) {
    await store.update("auction_events", eventId, { status: "CANCELLED", updated_at: nowIso() });
    return { ok: false, error: "Live Session could not be created." };
  }

  await store.create("auction_event_audit", {
    event_id: eventId,
    session_id: sessionId,
    lot_id: null,
    actor_user: me.id,
    action: "event:create",
    payload: JSON.stringify({ code, title }),
    created_at: nowIso(),
  });
  return {
    ok: true,
    event: await store.get("auction_events", eventId),
    session: await store.get("live_sessions", sessionId),
  };
}

export async function createAuctionVenue(
  store: EventStore,
  me: EventIdentity,
  input: {
    name: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    country?: string | null;
    timezone?: string | null;
  },
) {
  if (!me.admin) return { ok: false, error: "Administrator permission is required." };
  const name = clean(input.name, 160);
  const addressLine1 = clean(input.addressLine1, 200);
  const city = clean(input.city, 100);
  if (name.length < 2 || addressLine1.length < 3 || city.length < 2) {
    return { ok: false, error: "Venue name, address and city are required." };
  }
  const id = await store.create("auction_venues", {
    name,
    address_line1: addressLine1,
    address_line2: clean(input.addressLine2, 200) || null,
    city,
    country: clean(input.country || "Zimbabwe", 100),
    timezone: clean(input.timezone || "Africa/Harare", 80),
    active: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (id == null) return { ok: false, error: "Venue could not be created." };
  return { ok: true, venue: await store.get("auction_venues", id) };
}
