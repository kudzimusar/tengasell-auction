import { randomUUID } from "node:crypto";
import type { AuctionCoreIdentity, AuctionCoreStore } from "./auction-core";

export interface PolicyIdentity extends AuctionCoreIdentity {}

function commandKey(value: unknown, prefix: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && raw.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(raw)
    ? raw
    : `${prefix}:${randomUUID()}`;
}

export function productionModeRequested() {
  return process.env.TENGASELL_PRODUCTION_MODE === "1" || process.env.NODE_ENV === "production";
}

export async function productionGateReport(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  auctionId?: number | null,
) {
  const [policies, health, grants, outbox, financeBridge] = await Promise.all([
    store.list("auction_policy_registry", "order=policy_key&limit=500"),
    store.list("auction_service_health", "order=service_key&limit=100"),
    store.list("auction_operation_grants", "filter[active][$eq]=1&limit=500"),
    store.list("auction_outbox", "order=-id&limit=500"),
    store.list("auction_finance_bridge_outbox", "order=-id&limit=500"),
  ]);

  const missingPolicies = policies
    .filter((p) => Number(p.required_for_production) === 1 && Number(p.configured) !== 1)
    .map((p) => String(p.policy_key));

  const healthGates = health.map((row) => {
    const key = String(row.service_key);
    const expected = key === "LOCAL_COMMERCIAL_FALLBACK" ? "DISABLED" : "HEALTHY";
    const passed = Number(row.critical) !== 1 || String(row.status) === expected;
    return {
      key: `service:${key}`,
      passed,
      status: String(row.status),
      expected,
      detail: row.detail ?? null,
      critical: Number(row.critical) === 1,
    };
  });

  const localFallbackDisabled =
    process.env.TENGASELL_ALLOW_COMMERCIAL_LOCAL_FALLBACK !== "1" &&
    process.env.NEXT_PUBLIC_TENGASELL_EXPLICIT_DEMO !== "1";

  const operatorAuthorityPresent =
    actor.admin ||
    grants.some((grant) => Number(grant.active) === 1);

  const gateRows: Array<{ key: string; passed: boolean; critical: boolean; detail?: string | null }> = [
    {
      key: "canonical_database",
      passed: policies.length > 0,
      critical: true,
      detail: policies.length > 0 ? "Policy registry readable from canonical TrailBase." : "Canonical policy registry unavailable.",
    },
    {
      key: "trade_engine",
      passed: true,
      critical: true,
      detail: "Gate report executed inside canonical trade engine.",
    },
    {
      key: "policy_configuration",
      passed: missingPolicies.length === 0,
      critical: true,
      detail: missingPolicies.length ? `Missing required policy keys: ${missingPolicies.join(", ")}` : "Required policy keys configured.",
    },
    {
      key: "commercial_local_fallback_disabled",
      passed: localFallbackDisabled,
      critical: true,
      detail: localFallbackDisabled ? "Commercial LocalStore fallback disabled." : "Commercial LocalStore fallback is enabled.",
    },
    {
      key: "operator_authority",
      passed: operatorAuthorityPresent,
      critical: true,
      detail: operatorAuthorityPresent ? "Admin or scoped operator authority present." : "No operational authority present.",
    },
  ];

  gateRows.push(...healthGates);

  let auction: any = null;
  if (auctionId != null) {
    auction = await store.get("auctions", auctionId);
    if (auction?.asset_kind === "vehicle") {
      gateRows.push({
        key: "vehicle_reserve_disclosure",
        passed: String(auction.reserve_disclosure ?? "UNSPECIFIED") !== "UNSPECIFIED",
        critical: true,
        detail: `reserve_disclosure=${auction.reserve_disclosure ?? "UNSPECIFIED"}`,
      });
      gateRows.push({
        key: "vehicle_policy_profile",
        passed: String(auction.policy_profile_key ?? "").length > 0,
        critical: true,
        detail: String(auction.policy_profile_key ?? ""),
      });
    }
  }

  const pendingOutbox = outbox.filter((row) => !row.dispatched_at).length;
  const pendingFinanceBridge = financeBridge.filter((row) => !row.acknowledged_at).length;
  const criticalFailures = gateRows.filter((gate) => gate.critical && !gate.passed);

  return {
    productionMode: productionModeRequested(),
    ready: criticalFailures.length === 0,
    gates: gateRows,
    missingPolicies,
    observability: {
      auctionOutboxBacklog: pendingOutbox,
      financeBridgeBacklog: pendingFinanceBridge,
    },
    auction,
  };
}

export async function assertProductionMutationAllowed(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  auctionId?: number | null,
) {
  const report = await productionGateReport(store, actor, auctionId);
  if (!report.productionMode) return { ok: true as const, enforced: false, report };
  if (!report.ready) {
    return {
      ok: false as const,
      enforced: true,
      code: "PRODUCTION_GATE_BLOCKED",
      error: "Commercial mutation is blocked until all critical production gates are healthy and required policy is configured.",
      report,
    };
  }
  return { ok: true as const, enforced: true, report };
}

export async function submitPolicyCommand(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  input: {
    commandId?: string | null;
    policyKey: string;
    value?: unknown;
    classification?: string | null;
    configured?: boolean | null;
    reason: string;
  },
) {
  const key = commandKey(input.commandId, `policy:${input.policyKey}`);
  let row = (await store.list(
    "auction_policy_commands",
    `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  ))[0] ?? null;
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_policy_commands", {
      command_key: key,
      policy_key: input.policyKey,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: actor.admin ? 1 : 0,
      value_json: input.value === undefined ? null : JSON.stringify(input.value),
      classification: input.classification ?? null,
      configured: input.configured == null ? null : input.configured ? 1 : 0,
      reason: input.reason.trim().slice(0, 300),
    });
    row = id == null ? null : await store.get("auction_policy_commands", id);
  }
  if (!row) return { ok: false, code: "POLICY_COMMAND_PERSIST_FAILED", error: "Policy command could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "POLICY_COMMAND_REJECTED");
    return {
      ok: false,
      code,
      error: code === "POLICY_ADMIN_REQUIRED"
        ? "Administrator authority is required to change production auction policy."
        : "Auction policy command was rejected.",
      replayed,
      command: row,
    };
  }
  const policy = (await store.list(
    "auction_policy_registry",
    `filter[policy_key][$eq]=${encodeURIComponent(input.policyKey)}&limit=1`,
  ))[0] ?? null;
  return { ok: true, replayed, command: row, policy };
}

export async function updateServiceHealth(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  input: { serviceKey: string; status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN" | "DISABLED"; detail?: string | null },
) {
  if (!actor.admin)
    return { ok: false, code: "HEALTH_ADMIN_REQUIRED", error: "Administrator authority is required to certify production dependencies." };
  const row = (await store.list(
    "auction_service_health",
    `filter[service_key][$eq]=${encodeURIComponent(input.serviceKey)}&limit=1`,
  ))[0] ?? null;
  if (!row) return { ok: false, code: "HEALTH_SERVICE_UNKNOWN", error: "Unknown production dependency." };
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  await store.update("auction_service_health", row.id, {
    status: input.status,
    detail: input.detail ?? null,
    checked_by: actor.id,
    checked_by_username: actor.username,
    checked_at: now,
  });
  return {
    ok: true,
    health: (await store.list(
      "auction_service_health",
      `filter[service_key][$eq]=${encodeURIComponent(input.serviceKey)}&limit=1`,
    ))[0] ?? null,
  };
}

export async function submitVehicleRetractionRequest(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  input: {
    commandId?: string | null;
    auctionId: number;
    bidId: number;
    reason?: string | null;
    expectedVersion?: number | null;
  },
) {
  const lot = (await store.list(
    "auction_lots",
    `filter[auction_id][$eq]=${input.auctionId}&limit=1`,
  ))[0] ?? null;
  if (!lot) return { ok: false, code: "VEHICLE_EVENT_REQUIRED", error: "Vehicle bid retraction requires an auction event." };

  const key = commandKey(input.commandId, `vehicle-retract:${input.auctionId}:${input.bidId}`);
  let row = (await store.list(
    "auction_policy_retraction_requests",
    `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  ))[0] ?? null;
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_policy_retraction_requests", {
      command_key: key,
      auction_id: input.auctionId,
      event_id: Number(lot.event_id),
      target_bid_id: input.bidId,
      requester_user: actor.id,
      requester_username: actor.username,
      requester_admin: actor.admin ? 1 : 0,
      reason: input.reason?.trim().slice(0, 200) || null,
      expected_version: input.expectedVersion ?? null,
    });
    row = id == null ? null : await store.get("auction_policy_retraction_requests", id);
  }
  if (!row) return { ok: false, code: "RETRACTION_PERSIST_FAILED", error: "Retraction request could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "RETRACTION_REJECTED");
    const messages: Record<string,string> = {
      AUCTION_ALREADY_COMPLETE: "The auction is already complete; the pre-completion retraction right no longer applies.",
      RETRACTION_TARGET_NOT_ACTIVE: "That bid is no longer the active bid eligible for retraction.",
      RETRACTION_FORBIDDEN: "You may only retract your own active bid.",
      STALE_AUCTION_VERSION: "Auction state changed. Refresh before requesting retraction again.",
    };
    return { ok: false, code, error: messages[code] ?? "Bid retraction request was rejected.", replayed, request: row };
  }
  return {
    ok: true,
    replayed,
    request: row,
    amount: Number(row.result_price),
    winning: String(row.result_winner_user ?? "") === String(actor.id),
    outbid: String(row.result_winner_user ?? "") !== String(actor.id),
    auction: await store.get("auctions", input.auctionId),
  };
}

export async function policySnapshot(store: AuctionCoreStore) {
  const policies = await store.list("auction_policy_registry", "order=policy_key&limit=500");
  return policies.map((policy) => ({
    ...policy,
    value: typeof policy.value_json === "string" && policy.value_json
      ? (() => { try { return JSON.parse(policy.value_json); } catch { return policy.value_json; } })()
      : null,
  }));
}

export async function observabilitySnapshot(store: AuctionCoreStore) {
  const [events, outbox, financeBridge] = await Promise.all([
    store.list("auction_observability_events", "order=-id&limit=500"),
    store.list("auction_outbox", "order=-id&limit=500"),
    store.list("auction_finance_bridge_outbox", "order=-id&limit=500"),
  ]);
  return {
    signals: events,
    auctionOutboxBacklog: outbox.filter((row) => !row.dispatched_at).length,
    financeBridgeBacklog: financeBridge.filter((row) => !row.acknowledged_at).length,
  };
}


export async function updateAuctionDisclosure(
  store: AuctionCoreStore,
  actor: PolicyIdentity,
  input: {
    auctionId: number;
    reserveDisclosure: "NO_RESERVE" | "RESERVE_APPLIES" | "UPSET_APPLIES";
    ownerBidRightDisclosure?: "NOT_PERMITTED" | "DISCLOSED";
  },
) {
  const auction = await store.get("auctions", input.auctionId);
  if (!auction) return { ok: false, code: "AUCTION_NOT_FOUND", error: "Auction not found." };
  const owns = String(auction.user) === String(actor.id);
  if (!actor.admin && !owns)
    return { ok: false, code: "DISCLOSURE_FORBIDDEN", error: "Only the seller or administrator can set auction disclosures." };
  const hasReserve = auction.reserve_price != null;
  if (hasReserve && input.reserveDisclosure === "NO_RESERVE")
    return { ok: false, code: "RESERVE_DISCLOSURE_CONFLICT", error: "This auction has a reserve/upset value and cannot be advertised as no-reserve." };
  if (!hasReserve && input.reserveDisclosure !== "NO_RESERVE")
    return { ok: false, code: "RESERVE_DISCLOSURE_CONFLICT", error: "A reserve/upset disclosure requires an authoritative reserve/upset configuration." };
  await store.update("auctions", input.auctionId, {
    reserve_disclosure: input.reserveDisclosure,
    owner_bid_right_disclosure: input.ownerBidRightDisclosure ?? "NOT_PERMITTED",
    commercial_policy_ready: 1,
    updated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  });
  return { ok: true, auction: await store.get("auctions", input.auctionId) };
}
