// MOB-02 navigation contract — route registration and tab wiring.
// Static assertions: cheap, deterministic, and they fail if a screen is
// dropped from the router or a tab points at a route that does not exist.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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
  assert.equal((nav.match(/label: "/g) ?? []).length, 5);
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
  assert.match(orders, /No orders yet|Sign in to see your orders/);
  assert.doesNotMatch(orders, /fetchOrders|order_history/);
});
