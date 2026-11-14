import { test, expect } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = "http://127.0.0.1:3100";
const TRAILBASE_URL = "http://127.0.0.1:3001";
const ENGINE_URL = "http://127.0.0.1:3002";
const COMMS_URL = "http://127.0.0.1:3005";
const COMMS_DB_PATH = path.join(ROOT, "db/comms-uat.db");
const SCREENSHOT_DIR =
  process.env.UX01_SCREENSHOT_DIR ||
  "/Users/shadreckmusarurwa/.gemini/antigravity/brain/73d48699-8558-414e-b7e2-e4f4b6c620a9";

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
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { context, page, consoleErrors, pageErrors };
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

test.describe.configure({ mode: "serial" });

const tokens = {};

test.beforeAll(async () => {
  test.setTimeout(75000);
  const dbPath = path.join(ROOT, "prisma/dev.db");
  const dbEnv = { ...process.env, DATABASE_URL: `file:${dbPath}` };
  execSync("npx prisma db push --skip-generate", { cwd: ROOT, env: dbEnv, stdio: "pipe" });

  if (fs.existsSync(COMMS_DB_PATH)) {
    try {
      fs.unlinkSync(COMMS_DB_PATH);
    } catch {
      /* ignore */
    }
  }

  spawnService("trailbase-sqlite", "bun", ["run", "tests/helpers/local-trailbase-sqlite-server.ts"], {
    TRAILBASE_PORT: "3001",
  });
  await waitForHttp(`${TRAILBASE_URL}/__test/state`);

  spawnService("trade-engine", "bun", ["run", "mini-services/trade-engine/index.ts"], {
    TRAILBASE_URL,
    DATABASE_URL: `file:${dbPath}`,
    ENGINE_PORT: "3002",
  });
  await waitForHttp(`${ENGINE_URL}/socket.io/?EIO=4&transport=polling`);

  spawnService("comms-service", "bun", ["run", "mini-services/comms-service/index.ts"], {
    COMMS_PORT: "3005",
    TRAILBASE_URL,
    DATABASE_URL: `file:${dbPath}`,
    COMMS_DB_PATH,
    COMMS_ALLOW_EXTERNAL_R4: "0",
    APP_URL: BASE,
  });
  await waitForHttp("http://127.0.0.1:3005/health");

  spawnService("next-standalone", "node", [".next/standalone/server.js"], {
    PORT: "3000",
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${dbPath}`,
    TRAILBASE_URL,
    COMMS_URL: "http://127.0.0.1:3005",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  await waitForHttp("http://127.0.0.1:3000/api/public/status");

  spawnService("gateway", "node", ["scripts/gateway.mjs", "--port", "3100", "--app", "3000"]);
  await waitForHttp(`${BASE}/`);

  for (const actor of ["admin", "takudzwa", "nyasha", "simba"]) {
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
  await new Promise((r) => setTimeout(r, 400));
  if (fs.existsSync(COMMS_DB_PATH)) {
    try {
      fs.unlinkSync(COMMS_DB_PATH);
    } catch {
      /* ignore */
    }
  }
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const entry of children) {
      console.error(
        `=== ${entry.label} (exit=${entry.child.exitCode}, killed=${entry.child.killed}) ===\n${entry.getLogs()}`,
      );
    }
  }
});

test("R3A-UAT-01: Auction Hub follow/unfollow and reminder button state", async ({ browser }) => {
  await resetBackend();
  const { context, page, pageErrors } = await createActorContext(
    browser,
    { width: 1280, height: 800 },
    tokens.takudzwa,
  );

  await page.goto(`${BASE}/#/events`);
  await expect(page.getByRole("heading", { name: "Auction Hub" })).toBeVisible({ timeout: 10000 });

  const followBtn = page.locator('[data-testid="event-follow-btn"]').first();
  await expect(followBtn).toBeVisible({ timeout: 10000 });
  await expect(followBtn).toHaveAttribute("data-subscribed", "false");
  await expect(followBtn).toContainText(/Remind/i);

  // Follow event
  await followBtn.click();
  await expect(followBtn).toHaveAttribute("data-subscribed", "true", { timeout: 8000 });
  await expect(followBtn).toContainText(/Remind/i);
  await expect(page.getByText("Reminders active").first()).toBeVisible({ timeout: 8000 });

  await captureShot(page, "ux01-r3a-events-follow-1280.png");

  // Unfollow event
  await followBtn.click();
  await expect(followBtn).toHaveAttribute("data-subscribed", "false", { timeout: 8000 });
  await expect(page.getByText("Reminders removed").first()).toBeVisible({ timeout: 8000 });

  // Re-follow to populate active subscriptions for subsequent tests
  await followBtn.click();
  await expect(followBtn).toHaveAttribute("data-subscribed", "true", { timeout: 8000 });

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("R3A-UAT-02: Live Room header & lot follow controls and Item Page follow button", async ({
  browser,
}) => {
  const { context, page, pageErrors } = await createActorContext(
    browser,
    { width: 1280, height: 800 },
    tokens.takudzwa,
  );

  // Live Room follow controls
  await page.goto(`${BASE}/#/live/1`);
  await expect(page.getByTestId("live-sync-banner")).toHaveAttribute("data-sync-state", "connected", {
    timeout: 10000,
  });

  const headerFollowBtn = page.getByTestId("live-room-follow-event-btn");
  await expect(headerFollowBtn).toBeVisible();

  const lotFollowBtn = page.getByTestId("live-room-follow-lot-btn");
  await expect(lotFollowBtn).toBeVisible();
  await expect(lotFollowBtn).toHaveAttribute("data-subscribed", "false");

  // Follow Lot 1
  await lotFollowBtn.click();
  await expect(lotFollowBtn).toHaveAttribute("data-subscribed", "true", { timeout: 8000 });
  await expect(lotFollowBtn).toContainText(/Remind/i);

  // Item Page follow button
  await page.goto(`${BASE}/#/item/9101`);
  await expect(page.getByRole("heading", { name: /2021 Toyota Hilux/i })).toBeVisible({ timeout: 10000 });

  const itemFollowBtn = page.getByTestId("item-follow-auction-btn");
  await expect(itemFollowBtn).toBeVisible();
  await itemFollowBtn.click();
  await expect(itemFollowBtn).toHaveAttribute("data-subscribed", "true", { timeout: 8000 });

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("R3A-UAT-03: Communications Centre subscriptions panel, reminder evaluation, and one-click unsubscribe", async ({
  browser,
}) => {
  const { context, page, pageErrors } = await createActorContext(
    browser,
    { width: 1280, height: 800 },
    tokens.takudzwa,
  );

  await page.goto(`${BASE}/#/my/communications`);
  await expect(page.getByRole("heading", { name: "Communications", exact: true })).toBeVisible({
    timeout: 10000,
  });

  // Verify Active Auction Subscriptions & Reminders panel
  const subsSection = page.getByTestId("comms-subscriptions-section");
  await expect(subsSection).toBeVisible({ timeout: 10000 });
  await expect(subsSection.getByText("Active Auction Subscriptions & Reminders")).toBeVisible();
  await expect(subsSection.getByText("External Channel Governance Gate (R3A Phase)")).toBeVisible();

  // Active items list should contain the followed items
  const activeItems = subsSection.locator("ul[aria-label='Auction Subscriptions'] li");
  await expect(activeItems.first()).toBeVisible({ timeout: 10000 });
  const activeCount = await activeItems.count();
  expect(activeCount).toBeGreaterThanOrEqual(1);

  // Capture desktop screenshot
  await captureShot(page, "ux01-r3a-comms-subscriptions-1280.png");

  // Trigger evaluation
  const evalBtn = page.getByTestId("comms-evaluate-reminders-btn");
  await expect(evalBtn).toBeVisible();
  await evalBtn.click();

  // Toast should confirm evaluation
  await expect(page.getByText(/Reminders evaluated/i)).toBeVisible({ timeout: 10000 });

  // Notifications tray should show items
  const notifCard = page.locator("div:has-text('Recent Notifications')").first();
  await expect(notifCard).toBeVisible();

  // Test one-click unsubscribe
  const unsubBtn = subsSection.getByTestId("comms-unsubscribe-btn").first();
  await expect(unsubBtn).toBeVisible();
  await unsubBtn.click();
  await expect(page.getByText("Unsubscribed")).toBeVisible({ timeout: 8000 });

  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("R3A-UAT-04: Responsive 4-viewport layout and zero horizontal overflow across all auction & comms surfaces", async ({
  browser,
}) => {
  for (const vp of VIEWPORTS) {
    const { context, page, pageErrors } = await createActorContext(
      browser,
      { width: vp.width, height: vp.height },
      tokens.takudzwa,
    );

    // 1. Events Hub
    await page.goto(`${BASE}/#/events`);
    await expect(page.getByRole("heading", { name: "Auction Hub" })).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalOverflow(page);

    // 2. Live Room
    await page.goto(`${BASE}/#/live/1`);
    await expect(page.getByTestId("live-sync-banner")).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalOverflow(page);

    // 3. Item Page
    await page.goto(`${BASE}/#/item/9101`);
    await expect(page.getByTestId("item-follow-auction-btn")).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalOverflow(page);

    // 4. Communications Centre
    await page.goto(`${BASE}/#/my/communications`);
    await expect(page.getByRole("heading", { name: "Communications", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("comms-subscriptions-section")).toBeVisible({ timeout: 10000 });
    await assertNoHorizontalOverflow(page);

    if (vp.name === "mobile-390") {
      await captureShot(page, "ux01-r3a-comms-mobile-390.png");
    }

    expect(pageErrors).toEqual([]);
    await context.close();
  }
});
