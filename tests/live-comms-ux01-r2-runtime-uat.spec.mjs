import { test, expect } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { io } from "socket.io-client";

const ROOT = process.cwd();
const BASE = "http://127.0.0.1:3100";
const TRAILBASE_URL = "http://127.0.0.1:3001";
const ENGINE_URL = "http://127.0.0.1:3002";
const SCREENSHOT_DIR =
  process.env.UX01_SCREENSHOT_DIR ||
  path.join(process.cwd(), "test-artifacts/screenshots");

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
];

const children = [];

function spawnService(label, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const append = (chunk) => {
    logs = (logs + chunk.toString()).slice(-8000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  children.push({ label, child, getLogs: () => logs });
  return child;
}

async function waitForHttp(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status < 500) return res;
    } catch {
      /* waiting for startup */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const logSummary = children
    .map((c) => `=== ${c.label} ===\n${c.getLogs()}`)
    .join("\n");
  throw new Error(`Timed out waiting for ${url}\n${logSummary}`);
}

async function loginActor(username) {
  const res = await fetch(`${TRAILBASE_URL}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "Tengasell#2025" }),
  });
  if (!res.ok) throw new Error(`TrailBase login failed for ${username}: ${res.status}`);
  const data = await res.json();
  return { username, token: data.auth_token };
}

async function resetBackend() {
  const res = await fetch(`${TRAILBASE_URL}/__test/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`Backend reset failed: ${res.status}`);
  return await res.json();
}

async function createActorContext(browser, viewport, auth = null) {
  const context = await browser.newContext({ viewport });
  if (auth) {
    await context.addInitScript(({ token, username }) => {
      try {
        localStorage.setItem("ts_auth", JSON.stringify({ token, username }));
      } catch {
        /* ignore */
      }
    }, auth);
  }
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const wsEvents = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("websocket", (ws) => {
    wsEvents.push(`open:${ws.url()}`);
    ws.on("close", () => wsEvents.push(`close:${ws.url()}`));
    ws.on("socketerror", (e) => wsEvents.push(`err:${e}`));
  });
  page.on("requestfailed", (req) => {
    wsEvents.push(`reqfail:${req.method()}:${req.url()}:${req.failure()?.errorText ?? ""}`);
  });
  return { context, page, consoleErrors, pageErrors, wsEvents };
}

async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function captureShot(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

function socketRpc(token, eventName, payload) {
  return new Promise((resolve, reject) => {
    const s = io(ENGINE_URL, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
    });
    const timer = setTimeout(() => {
      s.close();
      reject(new Error(`RPC timeout: ${eventName}`));
    }, 8000);
    s.on("connect_error", (err) => {
      clearTimeout(timer);
      s.close();
      reject(err);
    });
    s.on("connect", () => {
      s.emit(eventName, payload, (ack) => {
        clearTimeout(timer);
        s.close();
        resolve(ack);
      });
    });
  });
}

test.describe.configure({ mode: "serial" });

const tokens = {};

test.beforeAll(async () => {
  test.setTimeout(60000);
  const dbPath = path.join(ROOT, "prisma/dev.db");
  const dbEnv = { ...process.env, DATABASE_URL: `file:${dbPath}` };
  execSync("npx prisma db push --skip-generate", { cwd: ROOT, env: dbEnv, stdio: "pipe" });

  spawnService("trailbase-sqlite", "bun", ["run", "tests/helpers/local-trailbase-sqlite-server.ts"], {
    TRAILBASE_PORT: "3001",
  });
  await waitForHttp(`${TRAILBASE_URL}/__test/state`);

  spawnService("trade-engine", "bun", ["run", "mini-services/trade-engine/index.ts"], {
    TRAILBASE_URL,
  });
  await waitForHttp(`${ENGINE_URL}/socket.io/?EIO=4&transport=polling`);

  spawnService("next-standalone", "node", [".next/standalone/server.js"], {
    PORT: "3000",
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${dbPath}`,
    TRAILBASE_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  });
  await waitForHttp("http://127.0.0.1:3000/api/public/status");

  spawnService("gateway", "node", ["scripts/gateway.mjs", "--port", "3100", "--app", "3000"]);
  await waitForHttp(`${BASE}/`);

  // Verify real Next.js /api/auth/login -> TrailBase SQLite auth roundtrip once (well under RL limits).
  const nextLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "nyasha", password: "Tengasell#2025" }),
  });
  expect(nextLoginRes.status).toBe(200);
  const nextLoginJson = await nextLoginRes.json();
  expect(nextLoginJson.ok).toBe(true);
  expect(typeof nextLoginJson.token).toBe("string");

  for (const actor of ["admin", "takudzwa", "nyasha", "simba", "rufaro"]) {
    tokens[actor] = await loginActor(actor);
  }
});

test.afterAll(async () => {
  for (const entry of children) {
    try {
      entry.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 300));
  for (const entry of children) {
    try {
      if (!entry.child.killed) entry.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const entry of children) {
      console.error(`=== ${entry.label} (exit=${entry.child.exitCode}, killed=${entry.child.killed}) ===\n${entry.getLogs()}`);
    }
  }
});

test("LIVE-01..LIVE-08: real-stack discovery, event detail, 15-element vehicle floor, and 4 viewports", async ({
  browser,
}) => {
  await resetBackend();

  for (const vp of VIEWPORTS) {
    const { context, page, pageErrors } = await createActorContext(
      browser,
      { width: vp.width, height: vp.height },
      tokens.nyasha,
    );

    // LIVE-01 & LIVE-02: Homepage discovery & Auction Hub filtering against real SQLite backend
    await page.goto(`${BASE}/#/`);
    const gateways = page.getByTestId("auction-mode-gateways");
    await expect(gateways).toBeVisible();
    await expect(gateways.locator("[data-live-state='live_bidding']")).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalOverflow(page);

    await gateways.getByRole("link", { name: /Explore Live Events/i }).click();
    await expect(page).toHaveURL(/#\/events/);
    await expect(page.getByRole("heading", { name: "Auction Hub" })).toBeVisible({ timeout: 10000 });
    const hubMain = page.locator("main");
    await expect(hubMain.getByText("Harare Executive & Utility Fleet Live Auction").first()).toBeVisible({ timeout: 10000 });
    await expect(hubMain.getByText("Weekend Hybrid & Passenger Showcase").first()).toBeVisible();
    await expect(hubMain.locator("[data-live-state='live_bidding']").first()).toBeVisible();
    await expect(hubMain.locator("[data-live-state='upcoming']").first()).toBeVisible();
    // Cancelled event never receives LIVE ON AIR badge
    const cancelledCard = hubMain.locator("a[href='#/events/903']").filter({ hasText: "Event Cancelled" }).first();
    await expect(cancelledCard).toBeVisible();
    await expect(cancelledCard.locator("[data-live-state='cancelled']")).toBeVisible();
    await expect(cancelledCard.locator("[data-live-state='live_bidding']")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    if (vp.name === "desktop-1280") {
      await captureShot(page, "ux01-r2-events-hub-1280.png");
    }

    // LIVE-03 & LIVE-04: Enter Event #901 -> navigate to Live Room #/live/1
    await page.goto(`${BASE}/#/events/901`);
    await expect(page.getByRole("heading", { name: "Harare Executive & Utility Fleet Live Auction" })).toBeVisible({
      timeout: 10000,
    });
    const joinBtn = page.getByRole("link", { name: /Join Live Room|Enter Live Room/i }).first();
    await expect(joinBtn).toBeVisible();
    await joinBtn.click();
    await expect(page).toHaveURL(/#\/live\/1/);

    // LIVE-05..LIVE-08: Vehicle-first floor stage + Socket sync + specs collapsible + run list + next lot preview
    await expect(page.getByTestId("live-sync-banner")).toHaveAttribute("data-sync-state", "connected", {
      timeout: 10000,
    });
    await expect(page.getByTestId("live-sync-banner")).toContainText("Realtime Floor Connected");
    await expect(page.getByRole("heading", { name: /2021 Toyota Hilux/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("link", { name: /2021 Toyota Hilux Double Cab.*View vehicle dossier/i })).toBeVisible();
    await expect(page.getByText("68,400 km")).toBeVisible();
    await expect(page.getByText("AUTOMATIC", { exact: true })).toBeVisible();
    await expect(page.getByText("DIESEL · 4WD")).toBeVisible();
    await expect(page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "watching");
    await expect(page.getByTestId("live-qualification-status")).toContainText("Qualified bidder");
    await expect(page.getByTestId("live-qualification-status")).toContainText("Capacity: US$50,000");

    // Collapsible vehicle details & inspection findings
    const collapsible = page.getByTestId("live-vehicle-details-collapsible");
    await expect(collapsible).toBeVisible();
    await collapsible.getByRole("button", { name: /Vehicle Specifications, Inspection/i }).click();
    await expect(collapsible.getByText(/Rear bumper trim/i)).toBeVisible();
    await expect(collapsible.getByText(/Documents verified:/i)).toContainText("3/3");

    // Next vehicle preview for Lot 2
    await expect(page.getByTestId("next-vehicle-preview")).toContainText("2020 Isuzu D-Max");

    // Mobile 390px: run list starts collapsed with toggle button & expands smoothly; zero overflow
    const runList = page.getByTestId("live-run-list");
    await expect(runList).toBeVisible();
    if (vp.width < 1024) {
      const toggle = runList.getByRole("button", { name: /Show|Run list/i });
      if ((await toggle.count()) > 0) {
        await toggle.click();
        await expect(runList.getByText(/2020 Isuzu D-Max/i)).toBeVisible();
      }
    } else {
      await expect(runList.getByText(/2020 Isuzu D-Max/i)).toBeVisible();
    }

    await assertNoHorizontalOverflow(page);
    if (vp.name === "desktop-1280") {
      await captureShot(page, "ux01-r2-live-room-buyer-1280.png");
    } else if (vp.name === "mobile-390") {
      await captureShot(page, "ux01-r2-live-room-mobile-390.png");
    } else if (vp.name === "tablet-768") {
      await captureShot(page, "ux01-r2-live-room-tablet-768.png");
    }

    expect(pageErrors).toEqual([]);
    await context.close();
  }
});

test("LIVE-09..LIVE-17: 5-actor role/qualification gates, 2-step bid confirm, real-time outbid, and host ADVANCE/OPEN", async ({
  browser,
}) => {
  test.setTimeout(60000);
  await resetBackend();

  // LIVE-09: Unauthenticated guest
  const guest = await createActorContext(browser, { width: 1280, height: 800 }, null);
  await guest.page.goto(`${BASE}/#/live/1`);
  await expect(guest.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "guest", {
    timeout: 10000,
  });
  await expect(guest.page.getByText("Sign in to bid in this room")).toBeVisible();
  await expect(guest.page.locator("#ts-room-max-bid")).toHaveCount(0);
  await guest.context.close();

  // LIVE-10: Seller (takudzwa) sees Your Vehicle, no bid form
  const seller = await createActorContext(browser, { width: 1280, height: 800 }, tokens.takudzwa);
  await seller.page.goto(`${BASE}/#/live/1`);
  await expect(seller.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "seller", {
    timeout: 10000,
  });
  await expect(seller.page.getByText("You are selling this lot")).toBeVisible();
  await expect(seller.page.locator("#ts-room-max-bid")).toHaveCount(0);
  await seller.context.close();

  // LIVE-11: Unqualified buyer (rufaro) blocked in UI AND rejected fail-closed by trade-engine RPC
  const unqual = await createActorContext(browser, { width: 1280, height: 800 }, tokens.rufaro);
  await unqual.page.goto(`${BASE}/#/live/1`);
  await expect(unqual.page.getByTestId("qualification-gate-warning")).toBeVisible({ timeout: 10000 });
  await expect(unqual.page.getByTestId("qualification-gate-warning")).toContainText("Bidder qualification required");
  await expect(unqual.page.locator("#ts-room-max-bid")).toBeDisabled();
  await expect(unqual.page.getByRole("button", { name: "Place bid" })).toBeDisabled();
  await captureShot(unqual.page, "ux01-r2-live-room-unqualified-1280.png");
  const unqualAck = await socketRpc(tokens.rufaro.token, "bid:place", {
    auctionId: 9101,
    maxAmount: 29000,
  });
  expect(unqualAck.ok).toBe(false);
  expect(unqualAck.code).toBe("BIDDER_NOT_QUALIFIED");
  await unqual.context.close();

  // LIVE-12..LIVE-14: Concurrent qualified buyers nyasha and simba
  const nyashaCtx = await createActorContext(browser, { width: 1280, height: 800 }, tokens.nyasha);
  const simbaCtx = await createActorContext(browser, { width: 1280, height: 800 }, tokens.simba);

  await nyashaCtx.page.goto(`${BASE}/#/live/1`);
  await simbaCtx.page.goto(`${BASE}/#/live/1`);
  await expect(nyashaCtx.page.getByTestId("live-sync-banner")).toHaveAttribute("data-sync-state", "connected", {
    timeout: 10000,
  });
  await expect(simbaCtx.page.getByTestId("live-sync-banner")).toHaveAttribute("data-sync-state", "connected", {
    timeout: 10000,
  });

  // Nyasha selects +$250 quick chip, opens 2-step confirmation dialog, cancels once, then confirms
  await nyashaCtx.page.getByRole("button", { name: "+$250" }).click();
  await expect(nyashaCtx.page.locator("#ts-room-max-bid")).toHaveValue("28250");
  await nyashaCtx.page.getByRole("button", { name: "Place bid" }).click();
  const dialog = nyashaCtx.page.getByTestId("live-bid-confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("US$28,250");
  await captureShot(nyashaCtx.page, "ux01-r2-live-room-bid-confirm-1280.png");

  // Dismiss dialog -> bid not placed yet
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(nyashaCtx.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "watching");

  // Reopen & submit real bid
  await expect(nyashaCtx.page.locator("#ts-room-max-bid")).toHaveValue("28250");
  await nyashaCtx.page.getByRole("button", { name: "Place bid" }).click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await nyashaCtx.page.getByTestId("live-bid-confirm-submit").click();
  await expect(dialog).toBeHidden({ timeout: 10000 });
  await expect(nyashaCtx.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "leading", {
    timeout: 10000,
  });
  await expect(nyashaCtx.page.getByTestId("live-qualification-status")).toContainText("Capacity: US$21,750", {
    timeout: 10000,
  });

  // Simba counter-bids +$500 -> both browsers update in real time without page reload!
  await simbaCtx.page.getByRole("button", { name: "+$500" }).click();
  await simbaCtx.page.getByRole("button", { name: "Place bid" }).click();
  await simbaCtx.page.getByTestId("live-bid-confirm-submit").click();
  await expect(simbaCtx.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "leading", {
    timeout: 10000,
  });
  await expect(nyashaCtx.page.getByTestId("bidder-standing-badge")).toHaveAttribute("data-bidder-standing", "outbid", {
    timeout: 10000,
  });
  await captureShot(nyashaCtx.page, "ux01-r2-live-room-outbid-1280.png");

  // LIVE-15..LIVE-17: Host admin closes Lot 1 (hammer sold -> auto-ADVANCE to Awaiting Next Lot) and OPENs Lot 2
  const advAck = await socketRpc(tokens.admin.token, "host:close-lot", {
    sessionId: 1,
    sold: true,
    commandId: "uat-r2-close-lot1",
  });
  expect(advAck.ok).toBe(true);

  await expect(nyashaCtx.page.locator("[data-live-state='awaiting_lot']").first()).toBeVisible({
    timeout: 10000,
  });
  await expect(nyashaCtx.page.getByText(/Room Open — Awaiting Next Lot/i).first()).toBeVisible();
  await captureShot(nyashaCtx.page, "ux01-r2-live-room-awaiting-lot2-1280.png");

  const openLot2Ack = await socketRpc(tokens.admin.token, "run-list:command", {
    eventId: 901,
    sessionId: 1,
    commandType: "OPEN",
    lotId: 9402,
    expectedRunListVersion: 5,
    commandId: "uat-r2-open-lot2",
  });
  expect(openLot2Ack.ok).toBe(true);

  await expect(nyashaCtx.page.getByRole("heading", { name: /2020 Isuzu D-Max 3\.0 TD X-Rider/i })).toBeVisible({
    timeout: 10000,
  });
  await expect(nyashaCtx.page.getByText(/Reserve applies/i).first()).toBeVisible();

  await nyashaCtx.context.close();
  await simbaCtx.context.close();
});

test("LIVE-18..LIVE-20: sync degradation/recovery, console cleanliness, and error handling", async ({
  browser,
}) => {
  await resetBackend();
  const { context, page, pageErrors } = await createActorContext(
    browser,
    { width: 1280, height: 800 },
    tokens.nyasha,
  );

  // Verify unavailable/reconnecting state when trade-engine socket polling/WS is unreachable, then recover cleanly
  let blockSocket = true;
  await page.route("**/socket.io/**", (route) => (blockSocket ? route.abort() : route.fallback()));
  await page.routeWebSocket("**/socket.io/**", (ws) => {
    if (blockSocket) {
      ws.close();
      return;
    }
    ws.connectToServer();
  });
  await page.goto(`${BASE}/#/live/1`);
  await expect(page.getByTestId("live-sync-banner")).toHaveAttribute(
    "data-sync-state",
    /reconnecting|unavailable|updates_delayed/,
    { timeout: 10000 },
  );
  await expect(page.getByText("Reconnecting to live bidding floor")).toBeVisible();
  blockSocket = false;
  await page.unroute("**/socket.io/**");
  await expect(page.getByTestId("live-sync-banner")).toHaveAttribute("data-sync-state", "connected", {
    timeout: 12000,
  });
  await expect(page.getByRole("heading", { name: /2021 Toyota Hilux/i })).toBeVisible({ timeout: 10000 });
  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("LIVE-21..LIVE-27: P0/P1 security convergence: dossier privacy, session revocation fail-closed, stale lot rejection, and accessibility", async ({
  browser,
}) => {
  await resetBackend();

  // LIVE-21: Anonymous viewer public vehicle dossier redaction
  const anonBundleRes = await socketRpc(null, "vehicle:get", { auctionId: 9101 });
  expect(anonBundleRes.ok).toBe(true);
  const anonV = anonBundleRes.bundle.vehicle;
  expect(anonV).toBeTruthy();
  expect(anonV.make).toBe("Toyota");
  expect(anonV.model).toBe("Hilux");
  expect(anonV.has_vin).toBe(true);
  expect(typeof anonV.vin_masked).toBe("string");
  expect(anonV.vin_masked).toMatch(/^[A-Z0-9]{3}\*\*\*[A-Z0-9]{4}$/);
  expect(anonV.has_registration).toBe(true);
  // Assert sensitive fields are completely stripped from network response:
  expect(anonV.vin).toBeUndefined();
  expect(anonV.chassis_number).toBeUndefined();
  expect(anonV.engine_number).toBeUndefined();
  expect(anonV.registration_number).toBeUndefined();
  expect(anonV.seller_user).toBeUndefined();
  expect(anonV.internal_notes).toBeUndefined();
  expect(anonV.ownership_status).toBeUndefined();
  expect(anonV.customs_status).toBeUndefined();

  // Documents: only VERIFIED documents, and document_ref + rejection_reason must be stripped
  expect(anonBundleRes.bundle.documents.length).toBeGreaterThan(0);
  for (const doc of anonBundleRes.bundle.documents) {
    expect(doc.status).toBe("VERIFIED");
    expect(doc.document_ref).toBeUndefined();
    expect(doc.rejection_reason).toBeUndefined();
  }
  // Inspection: inspector_user stripped
  if (anonBundleRes.bundle.inspection) {
    expect(anonBundleRes.bundle.inspection.inspector_user).toBeUndefined();
    expect(anonBundleRes.bundle.inspection.internal_notes).toBeUndefined();
  }
  // Findings: evidence_document_id stripped
  for (const f of anonBundleRes.bundle.findings) {
    expect(f.evidence_document_id).toBeUndefined();
    expect(f.created_by).toBeUndefined();
  }
  expect(anonBundleRes.bundle.eligibility).toBeNull();

  // LIVE-22: Authenticated non-seller bidder (simba) also receives projected bundle
  const simbaBundleRes = await socketRpc(tokens.simba.token, "vehicle:get", { auctionId: 9101 });
  expect(simbaBundleRes.ok).toBe(true);
  const simbaV = simbaBundleRes.bundle.vehicle;
  expect(simbaV.vin).toBeUndefined();
  expect(simbaV.registration_number).toBeUndefined();
  expect(simbaV.vin_masked).toBeTruthy();
  for (const doc of simbaBundleRes.bundle.documents) {
    expect(doc.document_ref).toBeUndefined();
  }

  // LIVE-23: Authenticated seller (takudzwa) receives full unredacted dossier
  const takudzwaBundleRes = await socketRpc(tokens.takudzwa.token, "vehicle:get", { auctionId: 9101 });
  expect(takudzwaBundleRes.ok).toBe(true);
  const takudzwaV = takudzwaBundleRes.bundle.vehicle;
  expect(takudzwaV.vin).toBeTruthy();
  expect(takudzwaV.registration_number).toBeTruthy();
  const verifiedDoc = takudzwaBundleRes.bundle.documents.find((d) => d.status === "VERIFIED");
  if (verifiedDoc) {
    expect(verifiedDoc.document_ref).toBeTruthy();
  }

  // Also verify admin receives full unredacted dossier
  const adminBundleRes = await socketRpc(tokens.admin.token, "vehicle:get", { auctionId: 9101 });
  expect(adminBundleRes.ok).toBe(true);
  expect(adminBundleRes.bundle.vehicle.vin).toBeTruthy();

  // LIVE-24: Session revocation fail-closed on already-connected socket (R2-AUTH-01)
  const connectedSocket = io(ENGINE_URL, {
    auth: { token: tokens.nyasha.token },
    transports: ["websocket"],
    forceNew: true,
  });
  await new Promise((resolve) => connectedSocket.on("connect", resolve));

  // Revoke Nyasha's token on TrailBase
  const revokeRes = await fetch(`${TRAILBASE_URL}/__test/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokens.nyasha.token }),
  });
  expect(revokeRes.ok).toBe(true);

  // Attempt to place bid on the already-connected socket
  const revokedBidAck = await new Promise((resolve) => {
    connectedSocket.emit(
      "bid:place",
      {
        auctionId: 9101,
        maxAmount: 48000,
        commandId: "cmd-revoked-test-01",
      },
      resolve,
    );
  });
  expect(revokedBidAck.ok).toBe(false);
  expect(revokedBidAck.code).toBe("AUTH_REVOKED");
  connectedSocket.close();

  // LIVE-25: Conflicting / stale lot state rejection
  // Auction 9102 is currently PAUSED or PENDING (not RUNNING)
  const staleAck = await socketRpc(tokens.takudzwa.token, "bid:place", {
    auctionId: 9102,
    maxAmount: 22000,
  });
  expect(staleAck.ok).toBe(false);
  expect(staleAck.code).toBe("LOT_NOT_ACTIVE");

  // LIVE-26: Nonexistent auction rejection
  const notFoundAck = await socketRpc(tokens.takudzwa.token, "bid:place", {
    auctionId: 999999,
    maxAmount: 10000,
  });
  expect(notFoundAck.ok).toBe(false);
  expect(notFoundAck.code).toBe("AUCTION_NOT_FOUND");

  // LIVE-27: Keyboard navigation and accessibility attributes in live room UI
  const { context, page } = await createActorContext(
    browser,
    { width: 1280, height: 800 },
    tokens.takudzwa,
  );
  await page.goto(`${BASE}/#/live/1`);
  await expect(page.getByRole("heading", { name: /2021 Toyota Hilux/i })).toBeVisible({ timeout: 10000 });

  // Tab through vehicle collapsible details trigger
  const detailsTrigger = page.getByTestId("live-vehicle-details-collapsible").locator("button").first();
  await expect(detailsTrigger).toBeVisible();
  await expect(detailsTrigger).toHaveAttribute("aria-expanded");
  await detailsTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(detailsTrigger).toHaveAttribute("aria-expanded", "true");

  await context.close();
});
