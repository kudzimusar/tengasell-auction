import { randomUUID } from "node:crypto";
import type { AuctionCoreIdentity, AuctionCoreStore } from "./auction-core";

export type OperationCapability =
  | "QUALIFICATION_REVIEWER"
  | "FINANCE_OPERATOR"
  | "RELEASE_OPERATOR"
  | "TRANSPORT_OPERATOR"
  | "AUCTION_OPERATOR"
  | "TASK_OPERATOR";

export interface OperationIdentity extends AuctionCoreIdentity {}

function safeKey(value: unknown, prefix: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && raw.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(raw)
    ? raw
    : `${prefix}:${randomUUID()}`;
}

function notExpired(value: unknown) {
  if (typeof value !== "string" || !value) return true;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > Date.now();
}

export async function hasOperationCapability(
  store: AuctionCoreStore,
  actor: OperationIdentity,
  capability: OperationCapability,
  eventId?: number | null,
) {
  if (actor.admin) return true;

  if (capability === "AUCTION_OPERATOR" && eventId != null) {
    const eventRoles = await store.list(
      "auction_event_operators",
      `filter[event_id][$eq]=${eventId}&filter[user][$eq]=${encodeURIComponent(actor.id)}&filter[active][$eq]=1&limit=20`,
    );
    if (eventRoles.some((row) => ["HOST", "AUCTIONEER", "CLERK"].includes(String(row.role)))) return true;
  }

  const grants = await store.list(
    "auction_operation_grants",
    `filter[user][$eq]=${encodeURIComponent(actor.id)}&filter[capability][$eq]=${capability}&filter[active][$eq]=1&limit=100`,
  );
  return grants.some((grant) => {
    if (!notExpired(grant.expires_at)) return false;
    if (grant.scope_key === "GLOBAL" || grant.event_id == null) return true;
    return eventId != null && Number(grant.event_id) === Number(eventId);
  });
}

export async function grantOperationCapability(
  store: AuctionCoreStore,
  actor: OperationIdentity,
  input: {
    user: string;
    username: string;
    capability: OperationCapability;
    eventId?: number | null;
    reason: string;
    expiresAt?: string | null;
  },
) {
  if (!actor.admin)
    return { ok: false, code: "OPERATION_GRANT_ADMIN_REQUIRED", error: "Administrator authority is required to grant auction operations capabilities." };
  const scopeKey = input.eventId == null ? "GLOBAL" : `EVENT:${Number(input.eventId)}`;
  const existing = (await store.list(
    "auction_operation_grants",
    `filter[user][$eq]=${encodeURIComponent(input.user)}&filter[capability][$eq]=${input.capability}&filter[scope_key][$eq]=${encodeURIComponent(scopeKey)}&limit=1`,
  ))[0];
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if (existing) {
    await store.update("auction_operation_grants", existing.id, {
      username: input.username,
      active: 1,
      granted_by: actor.id,
      granted_by_username: actor.username,
      reason: input.reason.trim().slice(0, 240),
      expires_at: input.expiresAt ?? null,
      granted_at: now,
      revoked_at: null,
    });
    return { ok: true, grant: await store.get("auction_operation_grants", existing.id), replayed: true };
  }
  const id = await store.create("auction_operation_grants", {
    user: input.user,
    username: input.username,
    capability: input.capability,
    scope_key: scopeKey,
    event_id: input.eventId ?? null,
    active: 1,
    granted_by: actor.id,
    granted_by_username: actor.username,
    reason: input.reason.trim().slice(0, 240),
    expires_at: input.expiresAt ?? null,
    granted_at: now,
    revoked_at: null,
  });
  const grant = id == null ? null : await store.get("auction_operation_grants", id);
  return grant ? { ok: true, grant, replayed: false } : { ok: false, code: "OPERATION_GRANT_PERSIST_FAILED", error: "Operation capability could not be persisted." };
}

export async function operationGrantsFor(
  store: AuctionCoreStore,
  viewer: OperationIdentity,
  userId?: string | null,
) {
  const target = viewer.admin && userId ? userId : viewer.id;
  const grants = await store.list(
    "auction_operation_grants",
    `filter[user][$eq]=${encodeURIComponent(target)}&order=-id&limit=200`,
  );
  return grants.filter((grant) => grant.active === 1 && notExpired(grant.expires_at));
}

export async function submitTaskCommand(
  store: AuctionCoreStore,
  actor: OperationIdentity,
  input: {
    commandId?: string | null;
    taskId: number;
    commandType: "ASSIGN" | "START" | "BLOCK" | "COMPLETE" | "CANCEL" | "REOPEN";
    assigneeUser?: string | null;
    assigneeUsername?: string | null;
    reason?: string | null;
  },
) {
  const task = await store.get("auction_tasks", input.taskId);
  if (!task) return { ok: false, code: "TASK_NOT_FOUND", error: "Operational task not found." };
  const assigned = task.assignee_user != null && String(task.assignee_user) === String(actor.id);
  const required = typeof task.required_capability === "string" ? task.required_capability as OperationCapability : null;
  const authorized =
    actor.admin ||
    assigned ||
    (await hasOperationCapability(store, actor, "TASK_OPERATOR", task.event_id == null ? null : Number(task.event_id))) ||
    (required ? await hasOperationCapability(store, actor, required, task.event_id == null ? null : Number(task.event_id)) : false);
  const key = safeKey(input.commandId, `task:${input.taskId}:${input.commandType}`);
  let row = (await store.list("auction_task_commands", `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`))[0] ?? null;
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_task_commands", {
      command_key: key,
      task_id: input.taskId,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_authorized: authorized ? 1 : 0,
      command_type: input.commandType,
      assignee_user: input.assigneeUser ?? null,
      assignee_username: input.assigneeUsername ?? null,
      reason: input.reason ?? null,
    });
    row = id == null ? null : await store.get("auction_task_commands", id);
  }
  if (!row) return { ok: false, code: "TASK_COMMAND_PERSIST_FAILED", error: "Task command could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "TASK_COMMAND_REJECTED");
    return { ok: false, code, error: code === "TASK_PERMISSION_REQUIRED" ? "You are not authorized to change this task." : "Task command was rejected.", replayed, command: row };
  }
  return { ok: true, replayed, command: row, task: await store.get("auction_tasks", input.taskId) };
}

export async function calendarProjection(
  store: AuctionCoreStore,
  actor: OperationIdentity,
  input: { from?: string | null; to?: string | null } = {},
) {
  const [events, settlements, transports] = await Promise.all([
    store.list("auction_events", "order=starts_at&limit=500"),
    store.list("auction_settlements", "order=settlement_deadline&limit=500"),
    store.list("auction_transport_bookings", "order=scheduled_at&limit=500"),
  ]);
  const canOperate =
    actor.admin ||
    (await hasOperationCapability(store, actor, "TASK_OPERATOR")) ||
    (await hasOperationCapability(store, actor, "AUCTION_OPERATOR")) ||
    (await hasOperationCapability(store, actor, "FINANCE_OPERATOR")) ||
    (await hasOperationCapability(store, actor, "RELEASE_OPERATOR")) ||
    (await hasOperationCapability(store, actor, "TRANSPORT_OPERATOR"));
  const ownSettlements = settlements.filter((s) =>
    canOperate || String(s.buyer_user) === String(actor.id) || String(s.seller_user) === String(actor.id)
  );
  const allowedSettlementIds = new Set(ownSettlements.map((s) => Number(s.id)));
  const items = [
    ...events.map((event) => ({
      key: `event:${event.id}`,
      type: "AUCTION_EVENT",
      at: event.starts_at,
      endAt: event.ends_at ?? null,
      title: event.title,
      entityType: "auction_event",
      entityId: Number(event.id),
      status: event.status,
    })),
    ...ownSettlements
      .filter((s) => s.settlement_deadline)
      .map((s) => ({
        key: `payment-deadline:${s.id}`,
        type: "PAYMENT_DEADLINE",
        at: s.settlement_deadline,
        endAt: null,
        title: `Payment deadline — order #${s.order_id}`,
        entityType: "settlement",
        entityId: Number(s.id),
        status: s.payment_state,
      })),
    ...transports
      .filter((t) => allowedSettlementIds.has(Number(t.settlement_id)) && t.scheduled_at)
      .map((t) => ({
        key: `transport:${t.id}`,
        type: "TRANSPORT_BOOKING",
        at: t.scheduled_at,
        endAt: null,
        title: `Transport — ${t.transporter}`,
        entityType: "transport",
        entityId: Number(t.id),
        status: t.status,
      })),
  ];
  const from = input.from ? Date.parse(input.from) : Number.NEGATIVE_INFINITY;
  const to = input.to ? Date.parse(input.to) : Number.POSITIVE_INFINITY;
  return items
    .filter((item) => {
      const at = Date.parse(String(item.at));
      return Number.isFinite(at) && at >= from && at <= to;
    })
    .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
}

export async function timelineProjection(
  store: AuctionCoreStore,
  actor: OperationIdentity,
  input: { entityType?: string | null; entityId?: number | null; settlementId?: number | null; eventId?: number | null },
) {
  let query = "order=id&limit=500";
  if (input.settlementId != null) query = `filter[settlement_id][$eq]=${input.settlementId}&order=id&limit=500`;
  else if (input.eventId != null) query = `filter[event_id][$eq]=${input.eventId}&order=id&limit=500`;
  else if (input.entityType && input.entityId != null)
    query = `filter[entity_type][$eq]=${encodeURIComponent(input.entityType)}&filter[entity_id][$eq]=${input.entityId}&order=id&limit=500`;

  if (input.settlementId != null) {
    const settlement = await store.get("auction_settlements", input.settlementId);
    if (!settlement) return [];
    const participant = String(settlement.buyer_user) === String(actor.id) || String(settlement.seller_user) === String(actor.id);
    const operator =
      actor.admin ||
      await hasOperationCapability(store, actor, "FINANCE_OPERATOR", settlement.event_id == null ? null : Number(settlement.event_id)) ||
      await hasOperationCapability(store, actor, "RELEASE_OPERATOR", settlement.event_id == null ? null : Number(settlement.event_id));
    if (!participant && !operator) return [];
  }
  return store.list("auction_timeline_events", query);
}

export async function operatorWorkbench(store: AuctionCoreStore, actor: OperationIdentity) {
  const grants = await operationGrantsFor(store, actor);
  const operator = actor.admin || grants.length > 0;
  if (!operator) return { ok: false, code: "OPERATOR_PERMISSION_REQUIRED", error: "Auction operations capability is required." };

  const [tasks, qualifications, settlements, alerts, events] = await Promise.all([
    store.list("auction_tasks", "order=due_at,id&limit=500"),
    store.list("auction_bidder_qualifications", "order=-id&limit=500"),
    store.list("auction_settlements", "order=-id&limit=500"),
    store.list("auction_operator_alerts", "order=-id&limit=500"),
    store.list("auction_events", "order=starts_at&limit=200"),
  ]);

  const caps = new Set(grants.map((g) => String(g.capability)));
  const taskVisible = (task: any) =>
    actor.admin ||
    String(task.assignee_user ?? "") === String(actor.id) ||
    caps.has("TASK_OPERATOR") ||
    !task.required_capability ||
    caps.has(String(task.required_capability));

  const visibleTasks = tasks.filter(taskVisible);
  const now = Date.now();
  return {
    ok: true,
    grants,
    tasks: visibleTasks,
    overdueTasks: visibleTasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED" && t.due_at && Date.parse(t.due_at) < now),
    qualificationQueue: actor.admin || caps.has("QUALIFICATION_REVIEWER")
      ? qualifications.filter((q) => ["PENDING", "ON_HOLD"].includes(String(q.status)))
      : [],
    paymentQueue: actor.admin || caps.has("FINANCE_OPERATOR")
      ? settlements.filter((s) => s.payment_state !== "PAID" && s.completion_state === "OPEN")
      : [],
    transferQueue: actor.admin || caps.has("RELEASE_OPERATOR")
      ? settlements.filter((s) => s.payment_state === "PAID" && s.transfer_state !== "COMPLETE")
      : [],
    releaseQueue: actor.admin || caps.has("RELEASE_OPERATOR")
      ? settlements.filter((s) => ["READY", "AUTHORIZED"].includes(String(s.release_state)) && s.completion_state === "OPEN")
      : [],
    transportQueue: actor.admin || caps.has("TRANSPORT_OPERATOR")
      ? settlements.filter((s) => !["NOT_REQUESTED", "DELIVERED", "CANCELLED"].includes(String(s.transport_state)))
      : [],
    alerts: alerts.filter((a) => a.status !== "RESOLVED"),
    events,
  };
}
