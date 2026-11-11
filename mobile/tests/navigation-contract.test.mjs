// MOB-02 navigation contract — route registration and tab wiring.
// Static assertions: cheap, deterministic, and they fail if a screen is
// dropped from the router or a tab points at a route that does not exist.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { computeGridMetrics } from "../src/lib/grid-layout.ts";
import { createRequestGuard } from "../src/lib/request-guard.ts";
import {
  englishStrings,
  translateNxs,
} from "../src/nxs/localization/catalog.ts";

const read = (p) => readFileSync(p, "utf8");

const ROUTES = [
  "src/app/index.tsx",
  "src/app/categories.tsx",
  "src/app/search.tsx",
  "src/app/orders.tsx",
  "src/app/you.tsx",
  "src/app/item/[id].tsx",
];

test("NAV-01 every product route exists", () => {
  for (const route of ROUTES) {
    assert.ok(existsSync(route), `missing route file: ${route}`);
  }
});

test("NAV-02 the root stack registers each route", () => {
  const layout = read("src/app/_layout.tsx");
  for (const name of ["index", "categories", "search", "orders", "you", "item/[id]"]) {
    assert.match(layout, new RegExp(`name="${name.replace("[", "\\[").replace("]", "\\]")}"`), `route not registered: ${name}`);
  }
});

test("NAV-03 the tab bar exposes exactly five destinations", () => {
  const nav = read("src/components/BottomNav.tsx");
  const routes = [...nav.matchAll(/route: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes, ["/", "/categories", "/search", "/orders", "/you"]);
  assert.equal((nav.match(/labelKey: "/g) ?? []).length, 5);
});

test("NAV-04 every tab route maps to a registered screen", () => {
  const nav = read("src/components/BottomNav.tsx");
  const mapping = { "/": "index", "/categories": "categories", "/search": "search", "/orders": "orders", "/you": "you" };
  const layout = read("src/app/_layout.tsx");
  for (const [, route] of [...nav.matchAll(/route: "([^"]+)"/g)]) {
    const screen = mapping[route];
    assert.ok(screen, `unmapped tab route: ${route}`);
    assert.match(layout, new RegExp(`name="${screen}"`), `tab route not registered: ${route}`);
  }
});

test("NAV-05 cards navigate to the item route", () => {
  const grid = read("src/components/ListingGrid.tsx");
  assert.match(grid, /router\.push\(`\/item\/\$\{item\.id\}`/);
});

test("NAV-06 home feeds cards through the shared grid contract", () => {
  const home = read("src/app/index.tsx");
  assert.match(home, /<AuctionCard/);
  assert.match(home, /router\.push\(`\/item\/\$\{item\.id\}`/);
});

test("NAV-07 Orders stays an honest placeholder (no fabricated order data)", () => {
  const orders = read("src/app/orders.tsx");
  assert.match(orders, /t\("orders\.emptyTitle"\)/);
  assert.match(orders, /t\("orders\.signedOutTitle"\)/);
  assert.equal(englishStrings["orders.emptyTitle"], "No orders yet");
  assert.equal(englishStrings["orders.signedOutTitle"], "Sign in to see your orders");
  assert.doesNotMatch(orders, /fetchOrders|order_history/);
});

test("MOB2-01 grid layout fits cleanly inside phone and tablet viewports without right-edge clipping", () => {
  const cases = [
    { viewportWidth: 320, columns: 2, padding: 12, safeLeft: 0, safeRight: 0 },
    { viewportWidth: 390, columns: 2, padding: 16, safeLeft: 0, safeRight: 0 },
    { viewportWidth: 844, columns: 2, padding: 16, safeLeft: 44, safeRight: 44 },
    { viewportWidth: 768, columns: 3, padding: 24, safeLeft: 0, safeRight: 0 },
    { viewportWidth: 1024, columns: 3, padding: 24, safeLeft: 0, safeRight: 0 },
    { viewportWidth: 1280, columns: 3, padding: 24, safeLeft: 0, safeRight: 0 },
  ];
  for (const input of cases) {
    const metrics = computeGridMetrics(input);
    assert.ok(metrics.cardWidth >= 80, `cardWidth too narrow for ${JSON.stringify(input)}`);
    assert.ok(
      metrics.totalRowWidth <= metrics.containerWidth + 0.001,
      `row width ${metrics.totalRowWidth} exceeds container ${metrics.containerWidth}`,
    );
    assert.ok(
      metrics.containerWidth <= metrics.usableViewportWidth + 0.001,
      `outer container overflows usable viewport for ${JSON.stringify(input)}`,
    );
    assert.equal(
      metrics.totalRowWidth,
      input.padding * 2 + metrics.cardWidth * input.columns + metrics.gap * (input.columns - 1),
    );
  }

  const home = read("src/app/index.tsx");
  const grid = read("src/components/ListingGrid.tsx");
  const categories = read("src/app/categories.tsx");
  assert.match(home, /computeGridMetrics\(/);
  assert.doesNotMatch(home, /const IMAGE_SIZE = Math\.min/);
  assert.match(grid, /computeGridMetrics\(/);
  assert.match(categories, /computeGridMetrics\(/);
  assert.match(home, /SafeAreaView style=\{styles\.safe\} edges=\{\["top", "left", "right"\]\}/);
});

test("MOB2-02 category and search requests ignore stale responses and clear errors on newer loads", async () => {
  const guard = createRequestGuard();
  const seen = [];

  const first = (async () => {
    const id = guard.next();
    await new Promise((r) => setTimeout(r, 25));
    if (guard.isCurrent(id)) seen.push("stale-first");
  })();

  const second = (async () => {
    const id = guard.next();
    await new Promise((r) => setTimeout(r, 5));
    if (guard.isCurrent(id)) seen.push("fresh-second");
  })();

  await Promise.all([first, second]);
  assert.deepEqual(seen, ["fresh-second"]);

  const pendingId = guard.next();
  guard.invalidate();
  assert.equal(guard.isCurrent(pendingId), false);

  const home = read("src/app/index.tsx");
  const categories = read("src/app/categories.tsx");
  const search = read("src/app/search.tsx");
  assert.match(home, /listRequestGuard\.isCurrent\(/);
  assert.match(home, /setError\(null\)/);
  assert.match(categories, /categoryRequestGuard\.isCurrent\(/);
  assert.match(categories, /categoryRequestGuard\.invalidate\(\)/);
  assert.match(categories, /setError\(null\)/);
  assert.match(search, /requestGuard\.isCurrent\(/);
  assert.match(search, /setError\(null\)/);
});

test("MOB2-03 You tab embeds account state cleanly without signed-out redirect loops or double bottom inset", () => {
  const you = read("src/app/you.tsx");
  const accountRoute = read("src/app/account/index.tsx");
  const accountContent = read("src/components/AccountContent.tsx");
  const nav = read("src/components/BottomNav.tsx");

  assert.match(you, /<AccountContent embeddedTab \/>/);
  assert.match(you, /<BottomNav active="you" \/>/);
  assert.match(accountRoute, /<AccountContent titleOverride=\{t\("account\.title"\)\} \/>/);
  assert.doesNotMatch(you, /router\.replace\("\/auth\/login"\)/);
  assert.match(accountContent, /if \(!embeddedTab\)\s*\{\s*router\.replace\("\/auth\/login"\)/);
  assert.match(accountContent, /embeddedTab\s*\?\s*\["top", "left", "right"\]\s*:\s*\["left", "right", "bottom"\]/);
  assert.match(accountContent, /t\("you\.signInAction"\)/);
  assert.match(nav, /safeArea\.bottom/);
  assert.match(nav, /paddingBottom: Math\.max\(bottomInset, 6\)/);
});

test("MOB2-04 strict NXS gating covers all routes/components, live-only search copy, and pseudolocale catalogs", () => {
  const verifyScript = read("scripts/verify-nxs-foundation.mjs");
  assert.doesNotMatch(verifyScript, /for \(const route of \[\s*"src\/app\/_layout\.tsx"/);
  assert.match(verifyScript, /walk\("src\/app"\)/);
  assert.match(verifyScript, /walk\("src\/components"\)/);
  assert.match(verifyScript, /accessibilityRole/);

  const home = read("src/app/index.tsx");
  const search = read("src/app/search.tsx");
  assert.match(home, /t\("home\.recentlySold"\)/);
  assert.doesNotMatch(home, />Recently sold</);
  assert.match(search, /t\("search\.promptLiveOnly"\)/);
  assert.match(search, /t\("search\.emptyNoResults"\)/);
  assert.equal(englishStrings["search.promptLiveOnly"], "Search currently live auctions.");

  const sampleValues = {
    count: 2,
    amount: "$10",
    category: "Tech",
    brand: "TengaSell",
    bidCount: 1,
    seller: "alice",
    remaining: "1h",
    city: "Harare",
    shipping: "Zim",
    date: "today",
    time: "now",
    query: "q",
    error: "err",
    price: "$5",
    status: "ok",
    url: "https://example.com",
    label: "Saving",
    message: "msg",
  };
  for (const key of Object.keys(englishStrings)) {
    const en = translateNxs(key, "en", sampleValues);
    const xa = translateNxs(key, "en-XA", sampleValues);
    const xb = translateNxs(key, "ar-XB", sampleValues);
    assert.ok(xa.length > en.length, `en-XA did not expand ${key}`);
    assert.ok(xb.includes("\u2067⟦"), `ar-XB missing RLI marker on ${key}`);
  }
});
