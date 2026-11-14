import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:3100";
const SCREENSHOT_DIR =
  process.env.UX01_SCREENSHOT_DIR ||
  path.join(process.cwd(), "test-artifacts/screenshots");

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
];

function jwt(username, admin = false) {
  const payload = Buffer.from(JSON.stringify({ username, admin })).toString("base64url");
  return "ux01." + payload + ".sig";
}

function profile(username, admin = false) {
  return {
    id: admin ? 1 : 2,
    user: admin ? "admin-id" : `${username}-id`,
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    bio: "UX-01 R1 UAT fixture",
    city: "Harare",
    rating_avg: 4.9,
    rating_count: 8,
    sales: 3,
    response_minutes: 15,
    verified: 1,
    joined_at: "2026-01-01T00:00:00Z",
  };
}

function isoOffset(ms) {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

function buildFixtures(mode) {
  const timedOpenAuction = {
    id: 101,
    user: "seller-id",
    seller_username: "seller",
    title: "2019 Mazda CX-5 Touring AWD",
    slug: "2019-mazda-cx5-touring-awd",
    description: "Clean single-owner SUV on timed online auction.",
    category: "vehicles",
    condition: "used",
    start_price: 12000,
    current_price: 14200,
    buy_now_price: null,
    bid_count: 6,
    watch_count: 14,
    views: 88,
    shipping_fee: 0,
    shipping: "pickup",
    city: "Harare",
    ends_at: isoOffset(8 * 3600_000),
    started_at: isoOffset(-24 * 3600_000),
    status: "live",
    extension_count: 0,
    featured: 1,
    images: "[]",
    created_at: isoOffset(-24 * 3600_000),
    updated_at: isoOffset(-3600_000),
    allow_offers: 0,
    offer_min: null,
    live_session_id: null,
    asset_kind: "vehicle",
    reserve_disclosure: "NO_RESERVE",
    owner_bid_right_disclosure: "NOT_PERMITTED",
  };

  const timedClosingAuction = {
    id: 102,
    user: "seller-id",
    seller_username: "seller",
    title: "Makita 18V Brushless Drill Kit",
    slug: "makita-18v-brushless-drill-kit",
    description: "Timed auction closing soon.",
    category: "tools",
    condition: "new",
    start_price: 180,
    current_price: 230,
    buy_now_price: null,
    bid_count: 9,
    watch_count: 11,
    views: 42,
    shipping_fee: 10,
    shipping: "courier",
    city: "Bulawayo",
    ends_at: isoOffset(25 * 60_000),
    started_at: isoOffset(-12 * 3600_000),
    status: "live",
    extension_count: 1,
    featured: 1,
    images: "[]",
    created_at: isoOffset(-12 * 3600_000),
    updated_at: isoOffset(-1800_000),
    allow_offers: 0,
    offer_min: null,
    live_session_id: null,
    asset_kind: "general",
  };

  const timedSoldAuction = {
    id: 103,
    user: "seller-id",
    seller_username: "seller",
    title: "2020 Nissan NP300 Hardbody",
    slug: "2020-nissan-np300-hardbody",
    description: "Completed timed listing.",
    category: "vehicles",
    condition: "used",
    start_price: 15000,
    current_price: 19400,
    buy_now_price: null,
    bid_count: 18,
    watch_count: 20,
    views: 205,
    shipping_fee: 0,
    shipping: "pickup",
    city: "Harare",
    ends_at: isoOffset(-2 * 3600_000),
    started_at: isoOffset(-72 * 3600_000),
    status: "sold",
    extension_count: 0,
    featured: 0,
    images: "[]",
    created_at: isoOffset(-72 * 3600_000),
    updated_at: isoOffset(-2 * 3600_000),
    allow_offers: 0,
    offer_min: null,
    live_session_id: null,
    asset_kind: "vehicle",
  };

  const liveLotAuction = {
    id: 201,
    user: "admin-id",
    seller_username: "admin",
    title: "Lot 1 — 2022 Toyota Fortuner GD-6",
    slug: "lot-1-2022-toyota-fortuner-gd6",
    description: "Live floor vehicle lot.",
    category: "vehicles",
    condition: "used",
    start_price: 34000,
    current_price: 38500,
    buy_now_price: null,
    bid_count: 12,
    watch_count: 35,
    views: 410,
    shipping_fee: 0,
    shipping: "pickup",
    city: "Harare",
    ends_at: isoOffset(4 * 3600_000),
    started_at: isoOffset(-3600_000),
    status: mode === "ended_lot_mismatch" ? "ended" : "live",
    extension_count: 0,
    featured: 0,
    images: "[]",
    created_at: isoOffset(-3600_000),
    updated_at: isoOffset(-60_000),
    allow_offers: 0,
    offer_min: null,
    live_session_id: 701,
    asset_kind: "vehicle",
    reserve_disclosure: "RESERVE_APPLIES",
    owner_bid_right_disclosure: "NOT_PERMITTED",
  };

  const lot201Row = {
    id: 5001,
    event_id: 71,
    auction_id: 201,
    sequence_no: 1,
    lot_order: 1,
    lot_number: "LOT-001",
    status:
      mode === "active_live" || mode === "expired_timer_unsettled"
        ? "LIVE"
        : mode === "ended_lot_mismatch"
          ? "SOLD"
          : "READY",
    title: liveLotAuction.title,
    auction: liveLotAuction,
  };

  const session701 =
    mode === "missing_session_mismatch"
      ? null
      : {
          id: 701,
          event_id: 71,
          host_user: "admin-id",
          host_username: "admin",
          title: "Harare Fleet Auction Day 1",
          description: "Scheduled flagship vehicle floor event.",
          scheduled_at: isoOffset(-15 * 60_000),
          started_at: isoOffset(-15 * 60_000),
          ended_at: null,
          status: "live",
          current_lot_id:
            mode === "active_live" ||
            mode === "sync_mismatch" ||
            mode === "ended_lot_mismatch" ||
            mode === "expired_timer_unsettled" ||
            mode === "cancelled_event"
              ? 201
              : null,
          close_at:
            mode === "active_live"
              ? isoOffset(30 * 60_000)
              : mode === "expired_timer_unsettled"
                ? isoOffset(-5000)
                : null,
          lot_index: mode === "active_live" || mode === "expired_timer_unsettled" ? 1 : 0,
          created_at: isoOffset(-86400_000),
          updated_at: isoOffset(-60_000),
        };

  const session702 = {
    id: 702,
    event_id: 72,
    host_user: "admin-id",
    host_username: "admin",
    title: "Bulawayo Plant & Earthmoving Event",
    description: "Upcoming live floor auction event.",
    scheduled_at: isoOffset(48 * 3600_000),
    started_at: null,
    ended_at: null,
    status: "scheduled",
    current_lot_id: null,
    close_at: null,
    lot_index: 0,
    created_at: isoOffset(-86400_000),
    updated_at: isoOffset(-3600_000),
  };

  const event71 = {
    id: 71,
    host_user: "admin-id",
    host_username: "admin",
    title: "Harare Fleet Auction Day 1",
    description: "Live floor fleet clearance event.",
    venue_id: 5,
    session_id: mode === "missing_session_mismatch" ? null : 701,
    starts_at: isoOffset(-15 * 60_000),
    ends_at: null,
    timezone: "Africa/Harare",
    status: mode === "sync_mismatch" ? "SCHEDULED" : mode === "cancelled_event" ? "CANCELLED" : "LIVE",
    version: 1,
    run_list_version: 3,
    run_list_locked: 1,
    current_lot_id:
      mode === "active_live" ||
      mode === "ended_lot_mismatch" ||
      mode === "expired_timer_unsettled"
        ? 5001
        : null,
    next_lot_id: null,
    created_at: isoOffset(-86400_000),
    updated_at: isoOffset(-60_000),
  };

  const event72 = {
    id: 72,
    host_user: "admin-id",
    host_username: "admin",
    title: "Bulawayo Plant & Earthmoving Event",
    description: "Scheduled live event — opens in 2 days.",
    venue_id: 5,
    session_id: 702,
    starts_at: isoOffset(48 * 3600_000),
    ends_at: null,
    timezone: "Africa/Harare",
    status: "SCHEDULED",
    version: 1,
    run_list_version: 1,
    run_list_locked: 0,
    current_lot_id: null,
    next_lot_id: null,
    created_at: isoOffset(-86400_000),
    updated_at: isoOffset(-3600_000),
  };

  const venue = {
    id: 5,
    name: "Borrowdale Sale Yard",
    address: "1 Borrowdale Rd",
    city: "Harare",
    country: "Zimbabwe",
    timezone: "Africa/Harare",
    venue_type: "PHYSICAL",
  };

  const auctionsMap = {
    101: timedOpenAuction,
    102: timedClosingAuction,
    103: timedSoldAuction,
    201: liveLotAuction,
  };

  const bidsMap = {
    101: [
      {
        id: 1,
        auction_id: 101,
        user: "other-id",
        bidder_username: "tafara",
        amount: 14200,
        max_amount: 14200,
        placed_amount: 14200,
        is_auto: 0,
        status: "active",
        created_at: isoOffset(-1800_000),
      },
    ],
    201: [
      {
        id: 2,
        auction_id: 201,
        user: "other-id",
        bidder_username: "rudo",
        amount: 38500,
        max_amount: 38500,
        placed_amount: 38500,
        is_auto: 0,
        status: "active",
        created_at: isoOffset(-120_000),
      },
    ],
  };

  const sessions =
    mode === "empty_schedule"
      ? []
      : mode === "upcoming_only" || mode === "missing_session_mismatch"
        ? [session702]
        : [session701, session702].filter(Boolean);

  const metrics = { bundleCalls: 0 };

  const events =
    mode === "empty_schedule"
      ? []
      : mode === "upcoming_only"
        ? [event72]
        : [event71, event72];

  return {
    timedOpenAuction,
    timedClosingAuction,
    timedSoldAuction,
    liveLotAuction,
    lot201Row,
    session701,
    session702,
    event71,
    event72,
    venue,
    auctionsMap,
    bidsMap,
    sessions,
    events,
    metrics,
  };
}

async function installUx01Authority(page, { mode = "active_live", signedIn = true, reducedMotion = false } = {}) {
  const fx = buildFixtures(mode);
  const token = jwt("buyer", false);

  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }

  if (signedIn) {
    await page.addInitScript(({ token }) => {
      localStorage.setItem("ts_auth", JSON.stringify({ token, username: "buyer" }));
    }, { token });
  }

  await page.route("**/api/comms/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/links")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ links: [] }) });
      return;
    }
    if (p.endsWith("/preferences") || p.endsWith("/prefs")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ taxonomy: [], prefs: {}, marketing: {} }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.route("**/*XTransformPort=3001*", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body = { records: [], total_count: 0 };

    if (p === "/api/records/v1/categories") {
      body = {
        records: [
          { id: 1, slug: "vehicles", name: "Vehicles", blurb: "Cars & pickups", icon: "🚗", sort_order: 1 },
          { id: 2, slug: "tools", name: "Tools", blurb: "Workshop tools", icon: "🔧", sort_order: 2 },
        ],
        total_count: 2,
      };
    } else if (p === "/api/auth/v1/status") {
      if (!signedIn) {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
        return;
      }
      body = { auth_token: token };
    } else if (p === "/api/records/v1/profiles") {
      const requested = url.searchParams.get("filter[username][$eq]") || "buyer";
      body = { records: [profile(requested, requested === "admin")], total_count: 1 };
    } else if (p === "/api/records/v1/live_sessions") {
      const idFilter = url.searchParams.get("filter[id][$eq]");
      const list = idFilter ? fx.sessions.filter((s) => s.id === Number(idFilter)) : fx.sessions;
      body = { records: list, total_count: list.length };
    } else if (/^\/api\/records\/v1\/live_sessions\/\d+$/.test(p)) {
      const id = Number(p.split("/").pop());
      const found = fx.sessions.find((s) => s.id === id);
      if (!found) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
        return;
      }
      body = found;
    } else if (p === "/api/records/v1/auction_events") {
      body = { records: fx.events, total_count: fx.events.length };
    } else if (/^\/api\/records\/v1\/auction_public\/\d+$/.test(p)) {
      const id = Number(p.split("/").pop());
      const found = fx.auctionsMap[id];
      if (!found) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
        return;
      }
      body = found;
    } else if (p === "/api/records/v1/auction_public") {
      const idFilter = url.searchParams.get("filter[id][$eq]");
      const liveSessFilter = url.searchParams.get("filter[live_session_id][$eq]");
      const endsLte = url.searchParams.get("filter[ends_at][$lte]");
      if (idFilter) {
        const a = fx.auctionsMap[Number(idFilter)];
        body = { records: a ? [a] : [], total_count: a ? 1 : 0 };
      } else if (liveSessFilter) {
        const recs = Number(liveSessFilter) === 701 ? [fx.liveLotAuction] : [];
        body = { records: recs, total_count: recs.length };
      } else if (endsLte) {
        body = { records: [fx.timedClosingAuction], total_count: 1 };
      } else {
        body = { records: [fx.timedOpenAuction, fx.timedClosingAuction], total_count: 2 };
      }
    } else if (p === "/api/records/v1/bids") {
      const auctionId = Number(url.searchParams.get("filter[auction_id][$eq]") || "0");
      const recs = fx.bidsMap[auctionId] ?? [];
      body = { records: recs, total_count: recs.length };
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.routeWebSocket("**/socket.io/**", (ws) => {
    ws.send("0" + JSON.stringify({
      sid: "ux01-socket",
      upgrades: [],
      pingInterval: 25000,
      pingTimeout: 20000,
      maxPayload: 1000000,
    }));
    ws.onMessage((message) => {
      const text = String(message);
      if (text.startsWith("40")) {
        ws.send("40" + JSON.stringify({ sid: "ux01-ns" }));
        return;
      }
      const match = text.match(/^42(\d+)(\[.*)$/s);
      if (!match) return;
      const id = match[1];
      const payload = JSON.parse(match[2]);
      const event = payload[0];
      const arg = payload[1] || {};
      let reply = { ok: true };

      if (event === "event:list") {
        reply = { ok: true, events: fx.events };
      } else if (event === "event:bundle") {
        fx.metrics.bundleCalls += 1;
        const evId = Number(arg.eventId);
        if (evId === 71 && mode !== "empty_schedule" && mode !== "upcoming_only") {
          reply = {
            ok: true,
            bundle: {
              event: fx.event71,
              venue: fx.venue,
              session: fx.session701,
              lots: mode === "awaiting_lot" ? [] : [fx.lot201Row],
              permissions: { operate: false, qualify: false, view: true },
            },
          };
        } else if (evId === 72 && mode !== "empty_schedule") {
          reply = {
            ok: true,
            bundle: {
              event: fx.event72,
              venue: fx.venue,
              session: fx.session702,
              lots: [],
              permissions: { operate: false, qualify: false, view: true },
            },
          };
        } else {
          reply = { ok: false, error: "Event not found" };
        }
      } else if (event === "qualification:bundle") {
        reply = {
          ok: true,
          bundle: {
            profile: null,
            limits: { approvedCapacity: 0, reservedCapacity: 0, availableCapacity: 0 },
            permissions: { selfQualify: true, administer: false },
          },
        };
      } else if (event === "vehicle:get") {
        reply = {
          ok: true,
          bundle: { vehicle: null, permissions: { inspect: false, review: false, administer: false } },
        };
      } else if (event === "bid:place") {
        const targetAuction = fx.auctionsMap[Number(arg.auctionId)];
        if (targetAuction) {
          const nextAmount = Number(arg.maxAmount);
          targetAuction.current_price = nextAmount;
          targetAuction.bid_count += 1;
          fx.bidsMap[targetAuction.id] = [
            {
              id: Date.now(),
              auction_id: targetAuction.id,
              user: "buyer-id",
              bidder_username: "buyer",
              amount: nextAmount,
              max_amount: nextAmount,
              placed_amount: nextAmount,
              is_auto: 0,
              status: "active",
              created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
            },
            ...(fx.bidsMap[targetAuction.id] ?? []),
          ];
          reply = {
            ok: true,
            auction: targetAuction,
            amount: nextAmount,
            winning: true,
            outbid: false,
          };
        }
      }

      ws.send("43" + id + JSON.stringify([reply]));
    });
  });

  return fx;
}

async function assertNoHorizontalOverflow(page) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(ok).toBeTruthy();
}

async function captureShot(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

for (const vp of VIEWPORTS) {
  test(`R1 scenarios 1-3, 5-7, 11-14 @ ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await installUx01Authority(page, { mode: "active_live", signedIn: true });

    // Scenario 1: Homepage displays both permanent gateways
    await page.goto(`${BASE}/#/`);
    const gateways = page.getByTestId("auction-mode-gateways");
    await expect(gateways).toBeVisible();
    await expect(gateways.getByText("Bid at Your Pace")).toBeVisible();
    await expect(gateways.getByText("Experience the Live Bidding Floor")).toBeVisible();

    const browseTimedCta = gateways.getByRole("link", { name: /Browse Timed Auctions/i });
    const exploreEventsCta = gateways.getByRole("link", { name: /Explore Live Events/i });
    await expect(browseTimedCta).toBeVisible();
    await expect(exploreEventsCta).toBeVisible();

    // Scenario 13: Interactive controls >= 44px height (retry across hydration/stylesheet settle)
    await expect(async () => {
      expect(await browseTimedCta.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
      expect(await exploreEventsCta.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
    }).toPass({ timeout: 5000 });

    // Scenario 5: Ordinary timed auctions show Open for Bids / Closing Soon, never red ON AIR
    await expect(page.locator("[data-timed-state='open']").first()).toContainText("Open for Bids");
    await expect(page.locator("[data-timed-state='closing_soon']").first()).toContainText("Closing Soon");
    await expect(page.getByText("Closing soon").locator("..").getByText("LIVE", { exact: true })).toHaveCount(0);

    // Scenario 6 (homepage rail): Genuine active live-room displays red Live Bidding Now ON AIR
    await expect(page.locator("[data-live-state='live_bidding']").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(page.getByTestId("auction-mode-gateways")).toBeVisible();
    await page.getByTestId("auction-mode-gateways").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await captureShot(page, `ux01-r1-home-${vp.name}.png`);

    // Scenario 2: Timed Auction gateway opens Timed Auctions marketplace (#/search)
    await browseTimedCta.click();
    await expect(page).toHaveURL(/#\/search/);
    await expect(page.getByRole("heading", { name: "Timed Auctions" })).toBeVisible();
    await expect(page.locator("[data-timed-state='open']").first()).toContainText("Open for Bids");
    await assertNoHorizontalOverflow(page);
    if (vp.name === "desktop-1280" || vp.name === "mobile-390") {
      await captureShot(page, `ux01-r1-timed-browse-${vp.name}.png`);
    }

    // Scenario 11 (mobile <= 2 taps): from /search back home -> Live Auction Events
    if (vp.width <= 768) {
      await page.goto(`${BASE}/#/`);
      await page.getByTestId("gateway-live-events").getByRole("link", { name: /Explore Live Events/i }).click();
    } else {
      await page.getByRole("link", { name: /Explore Live Auction Events/i }).click();
    }

    // Scenario 3 & 7 & 10: Auction Hub (#/events) shows Active live event AND Upcoming Live Event
    await expect(page).toHaveURL(/#\/events/);
    await expect(page.getByRole("heading", { name: "Auction Hub" })).toBeVisible();
    await expect(page.locator("[data-live-state='live_bidding']").first()).toBeVisible();
    await expect(page.locator("[data-live-state='upcoming']").first()).toContainText("Upcoming Live Event");
    await assertNoHorizontalOverflow(page);
    if (vp.name === "desktop-1280" || vp.name === "mobile-390") {
      await captureShot(page, `ux01-r1-events-hub-${vp.name}.png`);
    }

    // Scenario 14: Navigate from Auction Hub to #/my/communications (honest prefs explanation, zero fake buttons)
    const commsBanner = page.getByTestId("events-comms-banner");
    await expect(commsBanner).toBeVisible();
    await commsBanner.getByRole("link", { name: /Manage notification preferences/i }).click();
    await expect(page).toHaveURL(/#\/my\/communications/);
    await expect(page.getByTestId("comms-auction-roadmap-card")).toBeVisible();
    await expect(page.getByText(/Planned Live Event Notifications/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Follow Event|Subscribe to Event/i })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);

    await context.close();
  });
}

test("R1 scenarios 4, 6, 8, 9, 10: empty schedule, active room, awaiting lot, sync mismatch, and item bidding", async ({ browser }) => {
  // Scenario 4: Empty event schedule keeps homepage Live Events gateway discoverable
  const emptyCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const emptyPage = await emptyCtx.newPage();
  await installUx01Authority(emptyPage, { mode: "empty_schedule", signedIn: false });
  await emptyPage.goto(`${BASE}/#/`);
  await expect(emptyPage.getByTestId("gateway-live-events")).toBeVisible();
  await expect(emptyPage.getByTestId("gateway-live-events")).toContainText("Experience the Live Bidding Floor");
  await emptyPage.getByTestId("gateway-live-events").getByRole("link", { name: /Explore Live Events/i }).click();
  await expect(emptyPage).toHaveURL(/#\/events/);
  await expect(emptyPage.getByTestId("events-empty-guidance")).toBeVisible();
  // Signed-out user visiting #/my/communications still sees the explanation card
  await emptyPage.getByTestId("events-comms-banner").getByRole("link", { name: /Manage notification preferences/i }).click();
  await expect(emptyPage.getByTestId("comms-auction-roadmap-card")).toBeVisible();
  await emptyCtx.close();

  // Scenario 6 & 10: Event detail (#/events/71) + Live Board (#/live) + Active Live Room (#/live/701)
  const liveCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const livePage = await liveCtx.newPage();
  await installUx01Authority(livePage, { mode: "active_live", signedIn: true, reducedMotion: true });
  await livePage.goto(`${BASE}/#/events/71`);
  await expect(livePage.getByRole("heading", { name: "Harare Fleet Auction Day 1" })).toBeVisible();
  await expect(livePage.locator("[data-live-state='live_bidding']").first()).toContainText("Live Bidding Now · ON AIR");
  await livePage.goto(`${BASE}/#/live/701`);
  await expect(livePage.getByRole("link", { name: /All live rooms/i })).toBeVisible();
  await expect(livePage.locator("[data-live-state='live_bidding']").first()).toContainText("Live Bidding Now · ON AIR");
  await expect(livePage.getByText("Lot 1 — 2022 Toyota Fortuner GD-6").first()).toBeVisible();
  await captureShot(livePage, "ux01-r1-live-room-active-1280.png");
  await livePage.goto(`${BASE}/#/live`);
  await expect(livePage.locator("[data-live-state='live_bidding']").first()).toBeVisible();
  await expect(livePage.locator("[data-live-state='upcoming']").first()).toContainText("Upcoming Live Event");
  await liveCtx.close();

  // Scenario 8: Open room without current lot renders Room Open — Awaiting Next Lot without red ON AIR
  const waitCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const waitPage = await waitCtx.newPage();
  await installUx01Authority(waitPage, { mode: "awaiting_lot", signedIn: true });
  await waitPage.goto(`${BASE}/#/live/701`);
  await expect(waitPage.locator("[data-live-state='awaiting_lot']").first()).toContainText("Room Open — Awaiting Next Lot");
  await expect(waitPage.getByText("ON AIR")).toHaveCount(0);
  await captureShot(waitPage, "ux01-r1-live-room-awaiting-1280.png");
  await waitCtx.close();

  // Scenario 9a: Incompatible event/session state fails closed ("Status temporarily unavailable")
  const mismatchCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mismatchPage = await mismatchCtx.newPage();
  await installUx01Authority(mismatchPage, { mode: "sync_mismatch", signedIn: true });
  await mismatchPage.goto(`${BASE}/#/live/701`);
  await expect(mismatchPage.locator("[data-live-state='sync_mismatch']").first()).toContainText("Status temporarily unavailable");
  await expect(mismatchPage.getByRole("button", { name: /Place live bid/i })).toHaveCount(0);
  await expect(mismatchPage.getByText("ON AIR")).toHaveCount(0);

  // Scenario 9b: Item page timed bidding (#/item/101) remains functional & shows Open for Bids + Comms link
  await mismatchPage.goto(`${BASE}/#/item/101`);
  await expect(mismatchPage.getByRole("heading", { name: "2019 Mazda CX-5 Touring AWD" })).toBeVisible();
  await expect(mismatchPage.locator("[data-item-auction-mode='standalone_timed']").first()).toBeVisible();
  await expect(mismatchPage.locator("[data-timed-state='open']").first()).toContainText("Open for Bids");
  await expect(mismatchPage.getByTestId("item-comms-notice")).toBeVisible();
  await mismatchPage.getByRole("button", { name: /Place bid/i }).click();
  const bidDialog = mismatchPage.getByRole("dialog");
  await expect(bidDialog).toBeVisible();
  const bidInput = bidDialog.getByLabel(/Your maximum bid/i);
  await bidInput.fill("14600");
  await bidDialog.getByRole("button", { name: /Place bid/i }).click();
  await expect(mismatchPage.getByText(/You're the highest bidder/i).first()).toBeVisible();
  await expect(mismatchPage.getByText("US$14,600").first()).toBeVisible();
  await captureShot(mismatchPage, "ux01-r1-item-page-1280.png");
  await mismatchCtx.close();
});

test("R1 remediation A1-A5: zero request amplification, negative LIVE fails closed, LotStage gated, no premature SOLD, honest item modes", async ({ browser }) => {
  // A1: Auction Hub does not amplify or loop event:bundle calls across re-renders
  const hubCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const hubPage = await hubCtx.newPage();
  const hubFx = await installUx01Authority(hubPage, { mode: "active_live", signedIn: true });
  await hubPage.goto(`${BASE}/#/events`);
  await expect(hubPage.locator("[data-live-state='live_bidding']").first()).toBeVisible();
  await hubPage.waitForTimeout(800);
  expect(hubFx.metrics.bundleCalls).toBeLessThanOrEqual(2);
  await hubCtx.close();

  // A2: event.status=LIVE + missing session fails closed on Auction Hub (zero red Live Bidding Now / ON AIR)
  const missCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const missPage = await missCtx.newPage();
  await installUx01Authority(missPage, { mode: "missing_session_mismatch", signedIn: true });
  await missPage.goto(`${BASE}/#/events`);
  await expect(missPage.getByRole("heading", { name: "Auction Hub" })).toBeVisible();
  await expect(missPage.locator("[data-live-state='live_bidding']")).toHaveCount(0);
  await expect(missPage.getByText("ON AIR")).toHaveCount(0);
  await missCtx.close();

  // A3: Cancelled event & ended lot in LiveRoom strictly hide/block live bid form
  const cancelCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cancelPage = await cancelCtx.newPage();
  await installUx01Authority(cancelPage, { mode: "cancelled_event", signedIn: true });
  await cancelPage.goto(`${BASE}/#/live/701`);
  await expect(cancelPage.locator("[data-live-state='cancelled']").first()).toBeVisible();
  await expect(cancelPage.getByText("This live auction event has been cancelled. Bidding is closed.")).toBeVisible();
  await expect(cancelPage.locator("#ts-room-max-bid")).toHaveCount(0);
  await cancelCtx.close();

  // A4: Expired HammerClock countdown on live lot with bids shows neutral settlement-pending state (NEVER SOLD!)
  const expCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const expPage = await expCtx.newPage();
  await installUx01Authority(expPage, { mode: "expired_timer_unsettled", signedIn: true });
  await expPage.goto(`${BASE}/#/live/701`);
  await expect(expPage.getByTestId("hammer-clock-pending")).toContainText(/Countdown elapsed/i);
  await expect(expPage.getByText("SOLD!", { exact: true })).toHaveCount(0);
  await expCtx.close();

  // A5: Event-linked active floor vehicle (#/item/201) shows live floor identity, NOT contradictory Timed Auction label
  const itemCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const itemPage = await itemCtx.newPage();
  await installUx01Authority(itemPage, { mode: "active_live", signedIn: true });
  await itemPage.goto(`${BASE}/#/item/201`);
  await expect(itemPage.locator("[data-item-auction-mode='live_floor_active']").first()).toBeVisible();
  await expect(itemPage.getByTestId("item-auction-mode-banner")).toContainText("Currently on the Live Auction Floor");
  await expect(itemPage.getByRole("link", { name: /Enter Live Room/i }).first()).toBeVisible();
  await expect(itemPage.getByText("Timed Auction", { exact: true })).toHaveCount(0);
  await itemCtx.close();
});
