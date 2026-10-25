// TENGASELL-AUCTION-IMP-05 — Event / Session / Run-List authority.
// TrailBase remains canonical. Structural run-list changes are submitted as
// durable commands; SQLite serializes them and rejects stale operators.

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

export type EventAudit = (
  user: string | null,
  action: string,
  entity: string,
  entityId: number | null,
  source: string,
  payload: unknown,
) => Promise<void>;

export type RunListCommandType =
  | "ADD"
  | "MOVE"
  | "READY"
  | "WITHDRAW"
  | "LOCK"
  | "UNLOCK"
  | "OPEN"
  | "ADVANCE"
  | "CLOSE_EVENT";

export type RunListCommandInput = {
  commandKey?: string | null;
  eventId: number;
  sessionId: number;
  commandType: RunListCommandType;
  expectedRunListVersion: number;
  lotId?: number | null;
  auctionId?: number | null;
  targetSequenceNo?: number | null;
  reason?: string | null;
  source?: "OPERATOR" | "SYSTEM";
};

export type EventPermissions = {
  operate: boolean;
  host: boolean;
  auctioneer: boolean;
  clerk: boolean;
  administer: boolean;
};

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function safeKey(value: unknown, prefix: string) {
  const raw = clean(value, 160);
  if (raw && /^[A-Za-z0-9._:-]+$/.test(raw)) return raw;
  return `${prefix}:${randomUUID()}`;
}

function params(fields: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) q.set(key, String(value));
  return q.toString();
}

export function runListErrorMessage(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    EVENT_NOT_FOUND: "Auction event not found.",
    EVENT_SESSION_INTEGRITY: "The event/session relationship is invalid.",
    EVENT_CLOSED: "This auction event is closed.",
    OPERATOR_PERMISSION_REQUIRED: "Auction-event operator permission is required.",
    STALE_RUN_LIST_VERSION: "The run list changed before your command committed. Refresh and retry.",
    RUN_LIST_LOCKED: "The run list is locked. Unlock it before changing order or readiness.",
    RUN_LIST_ALREADY_LOCKED: "The run list is already locked.",
    RUN_LIST_NOT_LOCKED: "Lock the run list before opening a lot or closing the event.",
    AUCTION_NOT_FOUND: "Auction not found.",
    AUCTION_NOT_AVAILABLE_FOR_EVENT: "Only live auctions without bids or another room assignment can enter this run list.",
    LOT_ALREADY_ASSIGNED: "This auction is already assigned to an event run list.",
    INVALID_SEQUENCE: "That run-list position is invalid.",
    VEHICLE_NOT_ELIGIBLE: "This vehicle is not eligible for the auction run list.",
    LOT_NOT_FOUND: "Auction lot not found.",
    LOT_NOT_REORDERABLE: "This lot can no longer be reordered.",
    LOT_NOT_QUEUED: "Only a queued lot can be marked ready.",
    LOT_NOT_WITHDRAWABLE: "This lot can no longer be withdrawn.",
    WITHDRAWAL_REASON_REQUIRED: "Give a withdrawal reason.",
    CURRENT_LOT_OPEN: "Close the current lot before this action.",
    LOT_NOT_READY: "Mark the lot ready before opening it.",
    NO_CURRENT_LOT: "There is no matching current lot to advance.",
    LOT_OUTCOME_NOT_COMMITTED: "The auction outcome must commit before the run list advances.",
    IDEMPOTENCY_KEY_REUSE: "That run-list command id was already used for another request.",
    COMMAND_PERSIST_FAILED: "The run-list command could not be persisted.",
  };
  return messages[String(code ?? "")] ?? "The run-list command was rejected.";
}

export async function eventPermissions(
  store: EventStore,
  eventId: number,
  user: EventIdentity | null,
): Promise<EventPermissions> {
  if (!user) {
    return { operate: false, host: false, auctioneer: false, clerk: false, administer: false };
  }
  if (user.admin) {
    return { operate: true, host: true, auctioneer: true, clerk: true, administer: true };
  }
  const rows = await store.list(
    "auction_event_operators",
    params({
      "filter[event_id][$eq]": eventId,
      "filter[user][$eq]": user.id,
      "filter[active][$eq]": 1,
      limit: 20,
    }),
  );
  const roles = new Set(rows.map((row) => String(row.role)));
  const host = roles.has("HOST");
  const auctioneer = roles.has("AUCTIONEER");
  const clerk = roles.has("CLERK");
  return {
    operate: host || auctioneer || clerk,
    host,
    auctioneer,
    clerk,
    administer: host,
  };
}

export async function createAuctionEvent(
  store: EventStore,
  audit: EventAudit,
  me: EventIdentity,
  input: {
    title: string;
    description?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    timezone?: string | null;
    venue?: {
      name: string;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      timezone?: string | null;
      venueType?: "PHYSICAL" | "HYBRID" | "ONLINE";
    } | null;
  },
) {
  const title = clean(input.title, 120);
  if (title.length < 3) return { ok: false, error: "Give the auction event a title." };

  const startsMs = input.startsAt ? Date.parse(input.startsAt) : Date.now();
  if (!Number.isFinite(startsMs)) return { ok: false, error: "Event start time is invalid." };
  const startsAt = new Date(startsMs).toISOString().replace(/\.\d+Z$/, "Z");

  let endsAt: string | null = null;
  if (input.endsAt) {
    const endsMs = Date.parse(input.endsAt);
    if (!Number.isFinite(endsMs) || endsMs <= startsMs) {
      return { ok: false, error: "Event end time must be after the start." };
    }
    endsAt = new Date(endsMs).toISOString().replace(/\.\d+Z$/, "Z");
  }

  const timezone = clean(input.timezone || input.venue?.timezone || "Africa/Harare", 80) || "Africa/Harare";
  let venueId: number | null = null;
  if (input.venue) {
    const venueName = clean(input.venue.name, 120);
    if (venueName.length < 2) return { ok: false, error: "Venue name is required." };
    venueId = await store.create("auction_venues", {
      name: venueName,
      address: clean(input.venue.address, 240),
      city: clean(input.venue.city, 100),
      country: clean(input.venue.country || "Zimbabwe", 100),
      timezone: clean(input.venue.timezone || timezone, 80),
      venue_type: input.venue.venueType ?? "PHYSICAL",
      created_by: me.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    if (venueId == null) return { ok: false, error: "Auction venue could not be created." };
  }

  const eventId = await store.create("auction_events", {
    host_user: me.id,
    host_username: me.username,
    title,
    description: clean(input.description, 1200),
    venue_id: venueId,
    session_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone,
    status: "SCHEDULED",
    version: 0,
    run_list_version: 0,
    run_list_locked: 0,
    current_lot_id: null,
    next_lot_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (eventId == null) return { ok: false, error: "Auction event could not be created." };

  const event = await store.get("auction_events", eventId);
  const session = event?.session_id != null ? await store.get("live_sessions", Number(event.session_id)) : null;
  await audit(me.id, "auction_event:create.transport", "auction_events", eventId, "trade-engine", {
    sessionId: event?.session_id ?? null,
    venueId,
  });
  return { ok: true, event, session, venue: venueId != null ? await store.get("auction_venues", venueId) : null };
}

export async function eventBundle(
  store: EventStore,
  eventId: number,
  viewer: EventIdentity | null,
) {
  const event = await store.get("auction_events", eventId);
  if (!event) return { event: null, venue: null, session: null, lots: [], permissions: await eventPermissions(store, eventId, viewer) };

  const [venue, session, lotRows, permissions] = await Promise.all([
    event.venue_id != null ? store.get("auction_venues", Number(event.venue_id)) : Promise.resolve(null),
    event.session_id != null ? store.get("live_sessions", Number(event.session_id)) : Promise.resolve(null),
    store.list("auction_lots", params({ "filter[event_id][$eq]": eventId, order: "sequence_no", limit: 300 })),
    eventPermissions(store, eventId, viewer),
  ]);

  const lots = await Promise.all(
    lotRows
      .sort((a, b) => Number(a.sequence_no) - Number(b.sequence_no) || Number(a.id) - Number(b.id))
      .map(async (lot) => ({ ...lot, auction: await store.get("auctions", Number(lot.auction_id)) })),
  );

  const operators = permissions.operate
    ? await store.list("auction_event_operators", params({ "filter[event_id][$eq]": eventId, order: "id", limit: 100 }))
    : [];

  return { event, venue, session, lots, operators, permissions };
}

export async function grantEventOperator(
  store: EventStore,
  audit: EventAudit,
  me: EventIdentity,
  eventId: number,
  username: string,
  role: "AUCTIONEER" | "CLERK",
) {
  const event = await store.get("auction_events", eventId);
  if (!event) return { ok: false, error: "Auction event not found." };
  if (!me.admin && String(event.host_user) !== String(me.id)) {
    return { ok: false, error: "Only the event host or an administrator can assign operators." };
  }
  const targetName = clean(username, 80);
  const profiles = await store.list("profiles", params({ "filter[username][$eq]": targetName, limit: 1 }));
  const profile = profiles[0];
  if (!profile?.user) return { ok: false, error: "Operator account not found." };

  const existing = await store.list(
    "auction_event_operators",
    params({
      "filter[event_id][$eq]": eventId,
      "filter[user][$eq]": profile.user,
      "filter[role][$eq]": role,
      limit: 1,
    }),
  );
  if (existing[0]) {
    await store.update("auction_event_operators", existing[0].id, { active: 1 });
  } else {
    const id = await store.create("auction_event_operators", {
      event_id: eventId,
      user: profile.user,
      username: profile.username,
      role,
      active: 1,
      granted_by: me.id,
      granted_at: nowIso(),
    });
    if (id == null) return { ok: false, error: "Operator assignment could not be saved." };
  }
  await audit(me.id, "auction_event:operator:grant", "auction_events", eventId, "trade-engine", {
    username: profile.username,
    role,
  });
  return { ok: true, bundle: await eventBundle(store, eventId, me) };
}

async function findCommand(store: EventStore, commandKey: string) {
  const rows = await store.list(
    "run_list_commands",
    params({ "filter[command_key][$eq]": commandKey, limit: 1 }),
  );
  return rows[0] ?? null;
}

export async function submitRunListCommand(
  store: EventStore,
  me: EventIdentity,
  input: RunListCommandInput,
) {
  if (!Number.isInteger(input.eventId) || input.eventId <= 0 || !Number.isInteger(input.sessionId) || input.sessionId <= 0) {
    return { ok: false, code: "EVENT_SESSION_INTEGRITY", error: runListErrorMessage("EVENT_SESSION_INTEGRITY") };
  }
  if (!Number.isInteger(input.expectedRunListVersion) || input.expectedRunListVersion < 0) {
    return { ok: false, code: "STALE_RUN_LIST_VERSION", error: "A concrete run-list version is required." };
  }

  const commandKey = safeKey(input.commandKey, `runlist:${input.eventId}:${input.commandType.toLowerCase()}`);
  let existing = await findCommand(store, commandKey);
  let replayed = existing != null;

  if (existing) {
    const mismatch =
      Number(existing.event_id) !== input.eventId ||
      Number(existing.session_id) !== input.sessionId ||
      String(existing.command_type) !== input.commandType ||
      Number(existing.lot_id ?? 0) !== Number(input.lotId ?? 0) ||
      Number(existing.auction_id ?? 0) !== Number(input.auctionId ?? 0) ||
      Number(existing.target_sequence_no ?? 0) !== Number(input.targetSequenceNo ?? 0);
    if (mismatch) {
      return {
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSE",
        error: runListErrorMessage("IDEMPOTENCY_KEY_REUSE"),
        commandKey,
        replayed: true,
      };
    }
  } else {
    const id = await store.create("run_list_commands", {
      command_key: commandKey,
      event_id: input.eventId,
      session_id: input.sessionId,
      operator_user: me.id,
      operator_username: me.username,
      operator_admin: me.admin ? 1 : 0,
      command_type: input.commandType,
      lot_id: input.lotId ?? null,
      auction_id: input.auctionId ?? null,
      target_sequence_no: input.targetSequenceNo ?? null,
      reason: input.reason?.trim() ? input.reason.trim().slice(0, 300) : null,
      expected_run_list_version: input.expectedRunListVersion,
      source: input.source ?? "OPERATOR",
    });
    existing = id != null ? await store.get("run_list_commands", id) : await findCommand(store, commandKey);
    replayed = id == null && existing != null;
  }

  if (!existing) {
    return {
      ok: false,
      code: "COMMAND_PERSIST_FAILED",
      error: runListErrorMessage("COMMAND_PERSIST_FAILED"),
      commandKey,
      replayed,
    };
  }

  if (existing.status !== "accepted" && existing.status !== "idempotent_existing") {
    const code = String(existing.error_code ?? "COMMAND_REJECTED");
    return { ok: false, code, error: runListErrorMessage(code), commandKey, replayed, command: existing };
  }

  const event = await store.get("auction_events", input.eventId);
  const session = await store.get("live_sessions", input.sessionId);
  const lotId = existing.result_lot_id == null ? input.lotId : Number(existing.result_lot_id);
  const lot = lotId != null ? await store.get("auction_lots", Number(lotId)) : null;
  return {
    ok: true,
    commandKey,
    replayed,
    command: existing,
    event,
    session,
    lot,
    version: Number(existing.version_after ?? event?.run_list_version ?? input.expectedRunListVersion),
  };
}
