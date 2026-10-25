/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  calendarProjection,
  grantOperationCapability,
  operatorWorkbench,
  submitTaskCommand,
  timelineProjection,
} from "./operation-authority";
import type { AuctionCoreStore } from "./auction-core";

class OpsMemoryStore implements AuctionCoreStore {
  seq = 100;
  rows: Record<string, any[]> = {
    auction_operation_grants: [],
    auction_event_operators: [],
    auction_tasks: [
      {
        id: 1,
        task_key: "payment:1",
        task_type: "PAYMENT_FOLLOW_UP",
        entity_type: "settlement",
        entity_id: 10,
        event_id: 7,
        settlement_id: 10,
        assignee_user: null,
        assignee_username: null,
        required_capability: "FINANCE_OPERATOR",
        status: "TODO",
        priority: "HIGH",
        due_at: "2030-01-05T00:00:00Z",
      },
    ],
    auction_task_commands: [],
    auction_bidder_qualifications: [
      { id: 1, event_id: 7, user: "buyer", username: "buyer", status: "PENDING" },
    ],
    auction_settlements: [
      {
        id: 10,
        event_id: 7,
        order_id: 5001,
        buyer_user: "buyer",
        seller_user: "seller",
        payment_state: "PENDING",
        transfer_state: "NOT_STARTED",
        release_state: "BLOCKED",
        transport_state: "NOT_REQUESTED",
        completion_state: "OPEN",
        settlement_deadline: "2030-01-05T00:00:00Z",
      },
      {
        id: 11,
        event_id: 8,
        order_id: 5002,
        buyer_user: "other",
        seller_user: "seller2",
        payment_state: "PENDING",
        transfer_state: "NOT_STARTED",
        release_state: "BLOCKED",
        transport_state: "NOT_REQUESTED",
        completion_state: "OPEN",
        settlement_deadline: "2030-01-06T00:00:00Z",
      },
    ],
    auction_operator_alerts: [
      { id: 1, status: "OPEN", alert_type: "PAYMENT_OVERDUE", settlement_id: 10, severity: "WARNING" },
    ],
    auction_events: [
      { id: 7, title: "Harare Vehicle Auction", starts_at: "2030-01-04T08:00:00Z", ends_at: null, status: "SCHEDULED" },
    ],
    auction_transport_bookings: [
      { id: 20, settlement_id: 10, transporter: "Carrier", scheduled_at: "2030-01-06T08:00:00Z", status: "SCHEDULED" },
      { id: 21, settlement_id: 11, transporter: "Other carrier", scheduled_at: "2030-01-07T08:00:00Z", status: "SCHEDULED" },
    ],
    auction_timeline_events: [
      { id: 1, settlement_id: 10, event_id: 7, entity_type: "settlement", entity_id: 10, event_type: "SETTLEMENT_CREATED" },
      { id: 2, settlement_id: 11, event_id: 8, entity_type: "settlement", entity_id: 11, event_type: "SETTLEMENT_CREATED" },
    ],
  };

  async create(table: string, row: any) {
    this.rows[table] ??= [];
    const saved = { id: ++this.seq, ...row };
    if (table === "auction_task_commands") {
      saved.status = row.actor_authorized ? "accepted" : "rejected";
      saved.error_code = row.actor_authorized ? null : "TASK_PERMISSION_REQUIRED";
      if (saved.status === "accepted") {
        const task = this.rows.auction_tasks.find((candidate) => Number(candidate.id) === Number(row.task_id));
        if (task) {
          if (row.command_type === "START") task.status = "IN_PROGRESS";
          if (row.command_type === "COMPLETE") {
            task.status = "DONE";
            task.resolution = row.reason ?? null;
          }
          if (row.command_type === "ASSIGN") {
            task.assignee_user = row.assignee_user;
            task.assignee_username = row.assignee_username;
          }
        }
      }
    }
    this.rows[table].push(saved);
    return saved.id;
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

const admin = { id: "admin", username: "admin", admin: true };
const buyer = { id: "buyer", username: "buyer", admin: false };
const stranger = { id: "stranger", username: "stranger", admin: false };

test("ordinary account cannot grant auction operations capability", async () => {
  const store = new OpsMemoryStore();
  const result = await grantOperationCapability(store, stranger, {
    user: "buyer",
    username: "buyer",
    capability: "FINANCE_OPERATOR",
    reason: "attempted self escalation",
  });
  expect(result).toMatchObject({ ok: false, code: "OPERATION_GRANT_ADMIN_REQUIRED" });
});

test("scoped operation grant unlocks only server-authorized operational work", async () => {
  const store = new OpsMemoryStore();
  expect((await operatorWorkbench(store, buyer)).ok).toBe(false);

  const grant = await grantOperationCapability(store, admin, {
    user: buyer.id,
    username: buyer.username,
    capability: "FINANCE_OPERATOR",
    reason: "Finance desk assignment",
  });
  expect(grant.ok).toBe(true);

  const workbench = await operatorWorkbench(store, buyer);
  expect(workbench.ok).toBe(true);
  if (!workbench.ok) throw new Error("workbench unexpectedly denied");
  expect((workbench.paymentQueue ?? []).map((s: any) => s.id)).toEqual([10, 11]);
  expect(workbench.transferQueue).toHaveLength(0);

  const start = await submitTaskCommand(store, buyer, {
    commandId: "task-start-finance",
    taskId: 1,
    commandType: "START",
    reason: "Finance operator accepted payment follow-up",
  });
  expect(start.ok).toBe(true);
  expect(start.task?.status).toBe("IN_PROGRESS");
});

test("calendar is a projection and ordinary buyers see only their commercial deadlines", async () => {
  const store = new OpsMemoryStore();
  const items = await calendarProjection(store, buyer, {
    from: "2030-01-01T00:00:00Z",
    to: "2030-01-07T00:00:00Z",
  });
  expect(items.some((item) => item.key === "event:7")).toBe(true);
  expect(items.some((item) => item.key === "payment-deadline:10")).toBe(true);
  expect(items.some((item) => item.key === "payment-deadline:11")).toBe(false);
  expect(items.some((item) => item.key === "transport:20")).toBe(true);
  expect(items.some((item) => item.key === "transport:21")).toBe(false);
});

test("settlement timeline respects participant/operator visibility", async () => {
  const store = new OpsMemoryStore();
  const own = await timelineProjection(store, buyer, { settlementId: 10 });
  const other = await timelineProjection(store, buyer, { settlementId: 11 });
  expect(own.map((event) => event.id)).toEqual([1]);
  expect(other).toEqual([]);
});
