/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  assertProductionMutationAllowed,
  productionGateReport,
  submitPolicyCommand,
  updateAuctionDisclosure,
  updateServiceHealth,
} from "./policy-authority";
import type { AuctionCoreStore } from "./auction-core";

class PolicyStore implements AuctionCoreStore {
  seq = 100;
  rows: Record<string, any[]> = {
    auction_policy_registry: [
      { id: 1, policy_key: "legal.auction.completion_retraction", configured: 1, required_for_production: 1, classification: "LEGALLY_REQUIRED" },
      { id: 2, policy_key: "business.supplier_disclosure_profile", configured: 0, required_for_production: 1, classification: "CONFIGURABLE" },
      { id: 3, policy_key: "business.deposit_policy", configured: 0, required_for_production: 1, classification: "CONFIGURABLE" },
    ],
    auction_service_health: [
      { id: 10, service_key: "FINANCE", status: "UNKNOWN", critical: 1, detail: "not certified" },
      { id: 11, service_key: "TRUST", status: "HEALTHY", critical: 1, detail: null },
      { id: 12, service_key: "COMMS", status: "HEALTHY", critical: 1, detail: null },
      { id: 13, service_key: "MIGRATIONS", status: "HEALTHY", critical: 1, detail: null },
      { id: 14, service_key: "LOCAL_COMMERCIAL_FALLBACK", status: "DISABLED", critical: 1, detail: null },
    ],
    auction_operation_grants: [
      { id: 20, user: "operator", capability: "AUCTION_OPERATOR", active: 1 },
    ],
    auction_outbox: [],
    auction_finance_bridge_outbox: [],
    auction_policy_commands: [],
    auctions: [
      { id: 30, user: "seller", asset_kind: "vehicle", reserve_price: 1000, reserve_disclosure: "UNSPECIFIED", policy_profile_key: "ZW_VEHICLE_AUCTION_V1" },
      { id: 31, user: "seller", asset_kind: "vehicle", reserve_price: null, reserve_disclosure: "UNSPECIFIED", policy_profile_key: "ZW_VEHICLE_AUCTION_V1" },
    ],
  };

  async create(table: string, row: any) {
    this.rows[table] ??= [];
    const saved = { id: ++this.seq, ...row };
    if (table === "auction_policy_commands") {
      const policy = this.rows.auction_policy_registry.find((p) => p.policy_key === row.policy_key);
      if (!row.actor_admin) {
        saved.status = "rejected";
        saved.error_code = "POLICY_ADMIN_REQUIRED";
      } else if (!policy) {
        saved.status = "rejected";
        saved.error_code = "POLICY_NOT_FOUND";
      } else {
        saved.status = "accepted";
        saved.error_code = null;
        policy.value_json = row.value_json;
        if (row.classification != null) policy.classification = row.classification;
        if (row.configured != null) policy.configured = row.configured;
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
const seller = { id: "seller", username: "seller", admin: false };
const buyer = { id: "buyer", username: "buyer", admin: false };

beforeEach(() => {
  process.env.TENGASELL_PRODUCTION_MODE = "1";
  delete process.env.TENGASELL_ALLOW_COMMERCIAL_LOCAL_FALLBACK;
  delete process.env.NEXT_PUBLIC_TENGASELL_EXPLICIT_DEMO;
});

afterEach(() => {
  delete process.env.TENGASELL_PRODUCTION_MODE;
});

test("Production commercial mutation fails closed on missing policy and unhealthy Finance", async () => {
  const store = new PolicyStore();
  const report = await productionGateReport(store, buyer, 30);
  expect(report.ready).toBe(false);
  expect(report.missingPolicies).toEqual([
    "business.supplier_disclosure_profile",
    "business.deposit_policy",
  ]);
  expect(report.gates.find((g) => g.key === "service:FINANCE")?.passed).toBe(false);
  expect(report.gates.find((g) => g.key === "vehicle_reserve_disclosure")?.passed).toBe(false);

  const gate = await assertProductionMutationAllowed(store, buyer, 30);
  expect(gate).toMatchObject({ ok: false, enforced: true, code: "PRODUCTION_GATE_BLOCKED" });
});

test("administrator can converge required policy/health and open the Production gate without bypass", async () => {
  const store = new PolicyStore();

  const denied = await submitPolicyCommand(store, buyer, {
    commandId: "policy-denied",
    policyKey: "business.deposit_policy",
    value: { enabled: false },
    configured: true,
    reason: "ordinary user attempt",
  });
  expect(denied).toMatchObject({ ok: false, code: "POLICY_ADMIN_REQUIRED" });

  for (const [key, value] of [
    ["business.supplier_disclosure_profile", { approvedProfileRef: "LEGAL-APPROVED-SUPPLIER-DISCLOSURE" }],
    ["business.deposit_policy", { enabled: false }],
  ] as const) {
    const result = await submitPolicyCommand(store, admin, {
      commandId: `configure:${key}`,
      policyKey: key,
      value,
      configured: true,
      reason: "approved certification fixture configuration",
    });
    expect(result.ok).toBe(true);
  }

  const finance = await updateServiceHealth(store, admin, {
    serviceKey: "FINANCE",
    status: "HEALTHY",
    detail: "certification fixture health",
  });
  expect(finance.ok).toBe(true);

  const disclosure = await updateAuctionDisclosure(store, seller, {
    auctionId: 30,
    reserveDisclosure: "RESERVE_APPLIES",
    ownerBidRightDisclosure: "NOT_PERMITTED",
  });
  expect(disclosure.ok).toBe(true);

  const report = await productionGateReport(store, buyer, 30);
  expect(report.ready).toBe(true);
  const gate = await assertProductionMutationAllowed(store, buyer, 30);
  expect(gate).toMatchObject({ ok: true, enforced: true });
});

test("reserve disclosure cannot contradict canonical private reserve authority", async () => {
  const store = new PolicyStore();
  const hiddenReserve = await updateAuctionDisclosure(store, seller, {
    auctionId: 30,
    reserveDisclosure: "NO_RESERVE",
  });
  expect(hiddenReserve).toMatchObject({ ok: false, code: "RESERVE_DISCLOSURE_CONFLICT" });

  const inventedReserve = await updateAuctionDisclosure(store, seller, {
    auctionId: 31,
    reserveDisclosure: "RESERVE_APPLIES",
  });
  expect(inventedReserve).toMatchObject({ ok: false, code: "RESERVE_DISCLOSURE_CONFLICT" });
});
