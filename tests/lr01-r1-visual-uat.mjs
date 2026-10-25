import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.LR01_R1_BASE_URL ?? "http://127.0.0.1:8080";
const SHA = process.env.EXPECTED_HEAD_SHA ?? process.env.GITHUB_SHA ?? "unknown";
const OUT = process.env.LR01_R1_EVIDENCE_DIR ?? "artifacts/lr01-r1-visual-uat";
const PASSWORD = process.env.LR01_R1_DEMO_PASSWORD;
if (!PASSWORD) throw new Error("LR01_R1_DEMO_PASSWORD is required from the repository's existing demo fixture.");
const fixture = JSON.parse(fs.readFileSync(process.env.LR01_R1_FIXTURE_JSON ?? "/tmp/lr01-r1-fixture.json", "utf8"));

fs.mkdirSync(OUT, { recursive: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const file = (name) => path.join(OUT, name);

async function loginToken(request, username) {
  const response = await request.post(`${BASE}/api/auth/v1/login?XTransformPort=3001`, {
    data: { username, password: PASSWORD },
  });
  assert(response.ok(), `TrailBase login failed for ${username}: ${response.status()}`);
  const data = await response.json();
  assert(typeof data.auth_token === "string" && data.auth_token.length > 20, `No auth token for ${username}`);
  return data.auth_token;
}

async function readEvents(request) {
  const response = await request.get(`${BASE}/api/records/v1/auction_events?limit=200&XTransformPort=3001`);
  assert(response.ok(), `auction_events read failed: ${response.status()}`);
  const data = await response.json();
  return data.records ?? [];
}

const browser = await chromium.launch({ headless: true });
const apiContext = await browser.newContext();
const consoleErrors = [];
const httpFailures = [];

function instrument(page, persona) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${persona}] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${persona}] pageerror: ${e.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      httpFailures.push({ persona, status: response.status(), url: response.url() });
    }
  });
}

async function authenticatedPage(username, token, viewport = { width: 1440, height: 1000 }) {
  const browserContext = await browser.newContext({ viewport });
  await browserContext.addInitScript(({ username, token }) => {
    localStorage.setItem("ts_auth", JSON.stringify({ username, token }));
  }, { username, token });
  const page = await browserContext.newPage();
  instrument(page, username);
  return { browserContext, page };
}

const ordinaryToken = await loginToken(apiContext.request, fixture.ordinaryUsername);
const adminToken = await loginToken(apiContext.request, fixture.adminUsername);
const sellerToken = await loginToken(apiContext.request, "rufaro");

const beforeUnauthorized = await readEvents(apiContext.request);

// Ordinary account -> real UI -> api.createAuctionEvent -> Socket.IO event:create.
const ordinarySession = await authenticatedPage(fixture.ordinaryUsername, ordinaryToken);
let page = ordinarySession.page;
await page.goto(`${BASE}/#/events`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Auction Hub", exact: true }).waitFor();
await page.getByLabel("Event title").fill("LR01-R1 Unauthorized Bootstrap Attempt");
await page.getByRole("button", { name: "Request administrator authority" }).click();
await page.getByRole("alert").filter({ hasText: "Administrator permission is required" }).waitFor();
await page.screenshot({ path: file("09-unauthorized-event-create-rejection.png"), fullPage: true });
const afterUnauthorized = await readEvents(apiContext.request);
assert(afterUnauthorized.length === beforeUnauthorized.length, "unauthorized event:create mutated auction_events");

// Administrator -> same real UI/socket path -> accepted event + triggered session/HOST.
// Use a separate browser context so the ordinary user's socket/auth state cannot leak.
await ordinarySession.browserContext.close();
const adminSession = await authenticatedPage(fixture.adminUsername, adminToken);
page = adminSession.page;
await page.goto(`${BASE}/#/events`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Auction Hub", exact: true }).waitFor();
await page.getByLabel("Event title").fill("LR01-R1 Owner UAT — Vehicle Auction");
await page.getByLabel("Venue (optional)").fill("Tengasell Harare UAT Centre");
await page.getByLabel("City").fill("Harare");
await page.getByRole("button", { name: "Create auction event" }).click();
await page.waitForURL(/#\/events\/\d+$/);
await page.getByRole("heading", { name: "LR01-R1 Owner UAT — Vehicle Auction" }).waitFor();
const eventMatch = page.url().match(/#\/events\/(\d+)$/);
assert(eventMatch, "event id missing from authorized creation URL");
const eventId = Number(eventMatch[1]);
await page.getByText("Host admin", { exact: true }).waitFor();
await page.getByRole("heading", { name: "Operator controls" }).waitFor();
await page.screenshot({ path: file("10-authorized-admin-event-creation.png"), fullPage: true });

const operatorUrl = new URL("/api/records/v1/auction_event_operators", BASE);
operatorUrl.searchParams.set("XTransformPort", "3001");
operatorUrl.searchParams.set("filter[event_id][$eq]", String(eventId));
operatorUrl.searchParams.set("limit", "20");
const operatorResponse = await apiContext.request.get(operatorUrl.toString(), {
  headers: { Authorization: `Bearer ${adminToken}` },
});
assert(operatorResponse.ok(), `operator read failed: ${operatorResponse.status()}`);
const operators = (await operatorResponse.json()).records ?? [];
assert(
  operators.some((row) => row.role === "HOST" && row.username === fixture.adminUsername && Number(row.active) === 1),
  "authorized creator did not receive triggered HOST authority",
);

// Production run-list with one synthetic ELIGIBLE vehicle.
await page.getByLabel("Add auction ID").fill(String(fixture.auctionId));
await page.getByRole("button", { name: "Add to run list" }).click();
await page.getByText("LR01-R1 Synthetic 2022 Toyota Hilux GD-6", { exact: true }).waitFor();
await page.getByRole("button", { name: "Ready", exact: true }).click();
await page.getByText("READY", { exact: true }).waitFor();
await page.getByRole("button", { name: "Lock run list" }).click();
await page.getByText("Locked", { exact: true }).waitFor();

await page.setViewportSize({ width: 1440, height: 1000 });
await page.screenshot({ path: file("03-event-production-run-list-desktop.png"), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: file("04-event-production-run-list-mobile.png"), fullPage: true });

// Event-backed Live Room from the U10-created LiveSession.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("link", { name: "Open Live Room" }).click();
await page.waitForURL(/#\/live\/\d+$/);
const liveRoomInfo = page.locator('section[aria-label="LR01-R1 Owner UAT — Vehicle Auction"]');
await liveRoomInfo.waitFor({ state: "visible" });
await page.getByRole("link", { name: "Run List" }).waitFor({ state: "visible" });
await page.getByText("LR01-R1 Synthetic 2022 Toyota Hilux GD-6", { exact: true }).first().waitFor({ state: "visible" });
const sessionMatch = page.url().match(/#\/live\/(\d+)$/);
assert(sessionMatch, "event-backed session id missing from Live Room URL");
const sessionId = Number(sessionMatch[1]);
// The application uses a short route-transition fade. Require the destination
// UI first, then let that visual transition settle before capturing evidence.
await page.waitForTimeout(500);
await page.screenshot({ path: file("07-event-backed-live-room.png"), fullPage: true });

// Vehicle Item Page with Vehicle / inspection.
await page.goto(`${BASE}/#/item/${fixture.auctionId}`, { waitUntil: "domcontentloaded" });
await page.getByText("LR01-R1 Synthetic 2022 Toyota Hilux GD-6", { exact: true }).first().waitFor();
await page.getByRole("tab", { name: /Vehicle/ }).click();
await page.getByRole("heading", { name: "Vehicle authority" }).waitFor();
await page.getByText("ELIGIBLE", { exact: true }).first().waitFor();
await page.screenshot({ path: file("05-vehicle-inspection-item.png"), fullPage: true });

// Seller vehicle-intake flow. Use a separate context and do not submit a listing.
const adminPage = page;
const sellerSession = await authenticatedPage("rufaro", sellerToken);
page = sellerSession.page;
await page.goto(`${BASE}/#/sell/new`, { waitUntil: "domcontentloaded" });
await page.getByLabel("Category").click();
await page.getByRole("option", { name: /Vehicles/i }).click();
await page.getByRole("heading", { name: "Vehicle authority" }).waitFor();
await page.locator('section[aria-labelledby="vehicle-intake-heading"]').screenshot({
  path: file("06-seller-vehicle-intake.png"),
});
await sellerSession.browserContext.close();

// Hub + discoverability evidence after authorized event exists.
page = adminPage;
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${BASE}/#/events`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Auction Hub", exact: true }).waitFor();
await page.getByText("LR01-R1 Owner UAT — Vehicle Auction", { exact: true }).first().waitFor();
await page.screenshot({ path: file("01-auction-hub-desktop.png"), fullPage: true });

const globalNav = page.locator('nav[aria-label="Categories"]');
await globalNav.getByRole("button", { name: "Auction Hub" }).waitFor();
await globalNav.screenshot({ path: file("08-global-navigation-auction-hub.png") });

await page.setViewportSize({ width: 390, height: 844 });
await globalNav.getByRole("button", { name: "Auction Hub" }).waitFor();
await page.screenshot({ path: file("02-auction-hub-mobile.png"), fullPage: true });

// Same exact event still renders on mobile after all navigation changes.
await page.goto(`${BASE}/#/events/${eventId}`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Production Run List" }).waitFor();
await page.getByText("LR01-R1 Synthetic 2022 Toyota Hilux GD-6", { exact: true }).waitFor();

const finalEvents = await readEvents(apiContext.request);
const created = finalEvents.find((row) => Number(row.id) === eventId);
assert(created?.host_username === fixture.adminUsername, "created event host identity changed");

const manifest = {
  evidenceSha: SHA,
  runtime: {
    baseUrl: BASE,
    browser: `Chromium ${browser.version()}`,
    desktop: "1440x1000",
    mobile: "390x844",
  },
  fixture: {
    auctionId: fixture.auctionId,
    vehicleId: fixture.vehicleId,
    inspectionId: fixture.inspectionId,
    eligibilityId: fixture.eligibilityId,
    syntheticDisposableOnly: true,
  },
  authorization: {
    model: "existing EventIdentity.admin capability; event-local operator roles are not global creator authority",
    unauthorizedUsername: fixture.ordinaryUsername,
    unauthorizedResult: "REJECTED",
    eventCountBeforeUnauthorizedCall: beforeUnauthorized.length,
    eventCountAfterUnauthorizedCall: afterUnauthorized.length,
    authorizedUsername: fixture.adminUsername,
    authorizedResult: "ACCEPTED",
    hostBootstrap: "AUTHORIZED CREATOR ONLY",
    hostOperatorVerified: true,
    eventId,
    sessionId,
  },
  screenshots: fs.readdirSync(OUT).filter((name) => name.endsWith(".png")).sort(),
  consoleErrors,
  httpFailures,
};
fs.writeFileSync(file("manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("LR01-R1 exact-head Chromium visual UAT: PASS");
console.log(`evidence SHA=${SHA}`);
console.log("ordinary event:create=REJECTED");
console.log("authorized event:create=ACCEPTED");
console.log("HOST bootstrap=AUTHORIZED CREATOR ONLY");
console.log(`eventId=${eventId} sessionId=${sessionId} vehicleAuctionId=${fixture.auctionId}`);
console.log(`screenshots=${manifest.screenshots.length}`);

await adminSession.browserContext.close();
await apiContext.close();
await browser.close();
