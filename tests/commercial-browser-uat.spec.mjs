import { test, expect } from "@playwright/test";

const BASE = "http://127.0.0.1:3100";

function jwt(username, admin) {
  const payload = Buffer.from(JSON.stringify({ username, admin })).toString("base64url");
  return "cert." + payload + ".signature";
}

function profile(username, admin = false) {
  return {
    id: admin ? 1 : username === "buyer" ? 2 : 3,
    user: admin ? "admin-id" : username + "-id",
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    bio: "CERT-01 synthetic browser fixture",
    city: "Harare",
    rating_avg: 5,
    rating_count: 1,
    sales: 1,
    response_minutes: 30,
    verified: 1,
    joined_at: "2026-01-01T00:00:00Z",
  };
}

const auction = {
  id: 900,
  user: "seller-id",
  seller_username: "seller",
  title: "CERT-01 Toyota Hilux",
  slug: "cert-01-toyota-hilux",
  description: "Synthetic exact-head browser certification fixture.",
  category: "vehicles",
  condition: "used",
  start_price: 18000,
  current_price: 24500,
  buy_now_price: null,
  bid_count: 17,
  watch_count: 12,
  views: 100,
  shipping_fee: 0,
  shipping: "pickup",
  city: "Harare",
  ends_at: "2030-01-02T12:00:00Z",
  started_at: "2030-01-01T08:00:00Z",
  status: "sold",
  extension_count: 0,
  featured: 0,
  images: "[]",
  created_at: "2030-01-01T08:00:00Z",
  updated_at: "2030-01-02T12:00:00Z",
  allow_offers: 0,
  offer_min: null,
  live_session_id: 770,
  asset_kind: "vehicle",
  reserve_disclosure: "RESERVE_APPLIES",
  owner_bid_right_disclosure: "NOT_PERMITTED",
  policy_profile_key: "ZW_VEHICLE_AUCTION_V1",
  commercial_policy_ready: 1,
};

const order = {
  id: 501,
  auction_id: 900,
  auction_title: auction.title,
  buyer_user: "buyer-id",
  seller_user: "seller-id",
  buyer_username: "buyer",
  seller_username: "seller",
  final_price: 24500,
  status: "pending_payment",
  pay_by: "2030-01-04T12:00:00Z",
  paid_at: null,
  shipped_at: null,
  delivered_at: null,
  completed_at: null,
  carrier: null,
  tracking: null,
  address: null,
  created_at: "2030-01-02T12:00:00Z",
  updated_at: "2030-01-02T12:00:00Z",
};

const eventBundle = {
  event: {
    id: 77,
    host_user: "admin-id",
    host_username: "admin",
    title: "CERT-01 Harare Vehicle Auction",
    description: "Synthetic browser certification event",
    venue_id: 5,
    session_id: 770,
    starts_at: "2030-01-02T09:00:00Z",
    ends_at: null,
    timezone: "Africa/Harare",
    status: "SCHEDULED",
    version: 1,
    run_list_version: 2,
    run_list_locked: 0,
    current_lot_id: null,
    next_lot_id: 7001,
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
  },
  venue: {
    id: 5,
    name: "CERT Yard",
    address: "Synthetic address",
    city: "Harare",
    country: "Zimbabwe",
    timezone: "Africa/Harare",
    venue_type: "PHYSICAL",
  },
  session: {
    id: 770,
    host_user: "admin-id",
    host_username: "admin",
    title: "CERT-01 Harare Vehicle Auction",
    scheduled_at: "2030-01-02T09:00:00Z",
    status: "scheduled",
    current_lot_id: null,
    lot_index: 0,
    close_at: null,
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
    event_id: 77,
    next_lot_id: 7001,
    run_list_version: 2,
    run_list_locked: 0,
  },
  lots: [{
    id: 7001,
    event_id: 77,
    session_id: 770,
    auction_id: 900,
    sequence_no: 1,
    status: "READY",
    version: 1,
    original_ends_at: auction.ends_at,
    original_live_session_id: null,
    ready_at: "2030-01-01T01:00:00Z",
    opened_at: null,
    closed_at: null,
    withdrawn_at: null,
    withdrawal_reason: null,
    created_by: "admin-id",
    created_at: "2030-01-01T00:30:00Z",
    updated_at: "2030-01-01T01:00:00Z",
    auction,
  }],
  operators: [],
  permissions: { operate: false, host: false, auctioneer: false, clerk: false, administer: false },
};

const qualification = {
  qualification: {
    id: 801,
    event_id: 77,
    user: "buyer-id",
    username: "buyer",
    status: "QUALIFIED",
    qualification_basis: "MANUAL_REVIEW",
    approved_limit: 50000,
    lot_limit: 40000,
    account_state: "ELIGIBLE",
    risk_state: "CLEAR",
    deposit_state: "CONFIRMED",
    deposit_amount: 0,
    credit_state: "NONE",
    credit_limit: 0,
    reason_code: "APPROVED",
  },
  reservations: [],
  capacity: { approved: 50000, reserved: 32000, available: 18000 },
};

const settlement = {
  ok: true,
  settlement: {
    id: 601,
    order_id: 501,
    auction_id: 900,
    payment_state: "PENDING",
    paid_amount: 0,
    outstanding_amount: 24500,
    invoice_total: 24500,
    currency: "USD",
    settlement_deadline: "2030-01-04T12:00:00Z",
    transfer_state: "EXTERNAL_TRANSFER_PENDING",
    dispute_state: "NONE",
    release_state: "BLOCKED",
    transport_state: "REQUESTED",
    completion_state: "OPEN",
    seller_payout_state: "FINANCE_PENDING",
  },
  invoiceLines: [{ id: 1, line_key: "HAMMER", label: "Hammer price", amount: 24500, currency: "USD" }],
  transferDocuments: [{
    id: 1,
    document_type: "OWNERSHIP_TRANSFER",
    status: "ACCEPTED",
    external_process: 1,
  }],
  releaseAuthorization: null,
  transport: [{
    id: 1,
    transporter: "CERT Transport",
    pickup_location: "Harare Yard",
    destination: "Bulawayo",
    scheduled_at: "2030-01-05T08:00:00Z",
    status: "REQUESTED",
  }],
  handover: null,
  events: [],
};

const workbench = {
  ok: true,
  grants: [],
  tasks: [{
    id: 1,
    task_type: "PAYMENT_FOLLOW_UP",
    entity_type: "settlement",
    entity_id: 601,
    event_id: 77,
    settlement_id: 601,
    status: "TODO",
    priority: "HIGH",
    due_at: "2030-01-04T12:00:00Z",
  }],
  overdueTasks: [],
  qualificationQueue: [{
    id: 801,
    event_id: 77,
    user: "buyer-id",
    username: "buyer",
    status: "PENDING",
    approved_limit: 0,
    deposit_state: "CONFIRMED",
    credit_state: "NONE",
    qualification_basis: "MANUAL_REVIEW",
  }],
  paymentQueue: [{ ...settlement.settlement }],
  transferQueue: [{ ...settlement.settlement }],
  releaseQueue: [{ ...settlement.settlement, payment_state: "PAID", transfer_state: "COMPLETE", release_state: "READY" }],
  transportQueue: [{ ...settlement.settlement }],
  alerts: [{
    id: 1,
    alert_type: "PAYMENT_OVERDUE",
    severity: "WARNING",
    blocked_action: "TRANSFER_AND_RELEASE",
    resolver_capability: "FINANCE_OPERATOR",
    action_required: "Follow up payment; do not release the vehicle.",
    status: "OPEN",
  }],
  events: [eventBundle.event],
};

const gateReport = {
  ready: false,
  productionMode: true,
  missingPolicies: ["business.payment_deadline_hours", "business.deposit_policy", "business.fee_policy"],
  gates: [
    { key: "POLICY_CONFIGURATION", passed: false, detail: "Required Owner policy is not configured.", critical: true },
    { key: "FINANCE", passed: false, detail: "Finance health is UNKNOWN.", critical: true },
    { key: "NO_LOCAL_COMMERCIAL_FALLBACK", passed: true, detail: "Disabled.", critical: true },
  ],
  observability: { auctionOutboxBacklog: 0, financeBridgeBacklog: 2 },
};

function rpcResponse(event) {
  if (event === "event:bundle") return { ok: true, bundle: eventBundle };
  if (event === "qualification:bundle") return { ok: true, bundle: qualification };
  if (event === "settlement:bundle") return settlement;
  if (event === "operations:workbench") return workbench;
  if (event === "operations:calendar") {
    return {
      ok: true,
      items: [
        { key: "event:77", type: "AUCTION_EVENT", at: eventBundle.event.starts_at, title: eventBundle.event.title, status: "SCHEDULED", entityType: "auction_event", entityId: 77 },
        { key: "payment:601", type: "PAYMENT_DEADLINE", at: settlement.settlement.settlement_deadline, title: "Payment deadline — order #501", status: "PENDING", entityType: "settlement", entityId: 601 },
      ],
    };
  }
  if (event === "production:gates") return { ok: true, report: gateReport };
  if (event === "policy:snapshot") return { ok: true, policies: [{ policy_key: "legal.auction.completion_retraction", classification: "LEGALLY_REQUIRED" }] };
  if (event === "operations:observability") return { ok: true, auctionOutboxBacklog: 0, financeBridgeBacklog: 2 };
  return { ok: true };
}

async function installSyntheticAuthority(page, username, admin) {
  const token = jwt(username, admin);
  await page.addInitScript(({ token, username }) => {
    localStorage.setItem("ts_auth", JSON.stringify({ token, username }));
  }, { token, username });

  await page.route("**/*XTransformPort=3001*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let status = 200;
    let body = {};

    if (path === "/api/records/v1/categories") body = { records: [], total_count: 0 };
    else if (path === "/api/auth/v1/status") body = { auth_token: token };
    else if (path === "/api/records/v1/profiles") {
      const requested = url.searchParams.get("filter[username][$eq]") || username;
      body = { records: [profile(requested, requested === "admin")], total_count: 1 };
    } else if (path === "/api/records/v1/orders/501") body = order;
    else if (path === "/api/records/v1/payments") body = { records: [], total_count: 0 };
    else if (path === "/api/records/v1/auction_public/900") body = auction;
    else if (path === "/api/records/v1/auction_public") body = { records: [auction], total_count: 1 };
    else {
      body = { records: [], total_count: 0 };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/*XTransformPort=3006*", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "No finance receipt fixture" }) });
  });

  await page.routeWebSocket("**/socket.io/**", (ws) => {
    ws.send("0" + JSON.stringify({
      sid: "cert-socket",
      upgrades: [],
      pingInterval: 25000,
      pingTimeout: 20000,
      maxPayload: 1000000,
    }));
    ws.onMessage((message) => {
      const text = String(message);
      if (text.startsWith("40")) {
        ws.send("40" + JSON.stringify({ sid: "cert-socket-namespace" }));
        return;
      }
      const match = text.match(/^42(\d+)(\[.*)$/s);
      if (!match) return;
      const id = match[1];
      const payload = JSON.parse(match[2]);
      const event = payload[0];
      ws.send("43" + id + JSON.stringify([rpcResponse(event)]));
    });
  });
}

async function assertNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test("qualification " + viewport.name, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await installSyntheticAuthority(page, "buyer", false);
    await page.goto(BASE + "/#/events/77");
    await expect(page.getByRole("heading", { name: "Bidder qualification" })).toBeVisible();
    await expect(page.getByText("US$50,000")).toBeVisible();
    await expect(page.getByText("US$32,000")).toBeVisible();
    await expect(page.getByText("US$18,000")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await context.close();
  });

  test("won-lot settlement " + viewport.name, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await installSyntheticAuthority(page, "buyer", false);
    await page.goto(BASE + "/#/orders/501");
    await expect(page.getByRole("heading", { name: "Won-lot vehicle settlement" })).toBeVisible();
    await expect(page.getByText("Invoice & Finance")).toBeVisible();
    await expect(page.getByText("EXTERNAL · ACCEPTED")).toBeVisible();
    await expect(page.getByText("Payment is pending Finance confirmation.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request transport" })).toBeVisible();
    const height = await page.getByRole("button", { name: "Request transport" }).evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalOverflow(page);
    await context.close();
  });

  test("operator workbench " + viewport.name, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await installSyntheticAuthority(page, "admin", true);
    await page.goto(BASE + "/#/events/operations");
    await expect(page.getByRole("heading", { name: "Operator Workbench" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Qualification review queue" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release & handover queue" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zimbabwe Production readiness" })).toBeVisible();
    await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
    await expect(page.getByText(/business\.payment_deadline_hours/)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await context.close();
  });
}
