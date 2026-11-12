// TENGASELL-REC-01 — deterministic verification suite for auction recommendations,
// ranking, history isolation, and privacy controls.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WEIGHTS,
  RELEVANCE_FLOOR,
  compareRecommendations,
  diverseLive,
  endingSoon,
  filterEligible,
  moreFromSeller,
  mostActive,
  priceProximity,
  queryCoverage,
  rankCandidates,
  rankSearchResults,
  recentlyStarted,
  recommendedForHome,
  similarAuctions,
  suggestQueries,
  titleSimilarity,
  tokenize,
  validateWeights,
} from "../src/lib/recommend.ts";
import {
  createInMemoryStorage,
  createUserStore,
} from "../src/lib/user-store-logic.ts";

function makeMockAuction(overrides = {}) {
  return {
    id: 1001,
    user: "seller_alice",
    seller_username: "alice",
    title: "Google Pixel 8 Pro 128GB Unlocked",
    slug: "google-pixel-8-pro",
    description: "Mint condition Pixel 8 Pro in porcelain ceramic with original charger.",
    category: "phones",
    condition: "mint",
    start_price: 100,
    current_price: 320,
    buy_now_price: 550,
    reserve_price: 300,
    bid_count: 5,
    watch_count: 12,
    views: 88,
    shipping_fee: 5,
    shipping: "courier",
    city: "Harare",
    ends_at: "2026-11-14T12:00:00.000Z",
    started_at: "2026-11-10T12:00:00.000Z",
    status: "live",
    extension_count: 0,
    featured: 1,
    images: JSON.stringify(["https://example.com/pixel8.jpg"]),
    imageList: ["https://example.com/pixel8.jpg"],
    endingSoon: false,
    hasBids: true,
    reserveMet: true,
    created_at: "2026-11-10T12:00:00.000Z",
    updated_at: "2026-11-11T12:00:00.000Z",
    ...overrides,
  };
}

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

test("REC-01 weights configuration and validation", () => {
  const problems = validateWeights(DEFAULT_WEIGHTS);
  assert.deepEqual(problems, [], "DEFAULT_WEIGHTS should be valid");
  assert.ok(DEFAULT_WEIGHTS.query >= 0.3, "query relevance must carry substantial weight");

  // Invalid weights rejected
  const invalid = { ...DEFAULT_WEIGHTS, activity: 0.9, urgency: 0.8 };
  const issues = validateWeights(invalid);
  assert.ok(issues.length > 0, "engagement higher than relevance must fail");
});

test("REC-02 tokenization, query coverage and title similarity", () => {
  const tokens = tokenize("The Google Pixel 8 Pro (Mint) with Charger & Cable!");
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("with"));
  assert.ok(tokens.includes("google"));
  assert.ok(tokens.includes("pixel"));
  assert.ok(tokens.includes("pro"));

  const target = makeMockAuction();
  assert.equal(queryCoverage("pixel pro", target), 1);
  assert.equal(queryCoverage("unrelated solar inverter", target), 0);

  const simHigh = titleSimilarity("Google Pixel 8 Pro", "Google Pixel 8 Pro 256GB");
  const simLow = titleSimilarity("Google Pixel 8 Pro", "DeWalt Cordless Drill 18V");
  assert.ok(simHigh > 0.6, `expected high title similarity, got ${simHigh}`);
  assert.equal(simLow, 0);
});

test("REC-03 price proximity scoring", () => {
  const close = priceProximity(300, 320);
  const distant = priceProximity(300, 3000);
  assert.ok(close > 0.8, "similar prices should score high");
  assert.ok(distant < close, "distant prices must score lower");
});

test("REC-04 eligibility filtering drops draft, cancelled, and expired in live-only mode", () => {
  const pool = [
    makeMockAuction({ id: 1, status: "live", ends_at: "2026-11-13T12:00:00.000Z" }),
    makeMockAuction({ id: 2, status: "draft" }),
    makeMockAuction({ id: 3, status: "cancelled" }),
    makeMockAuction({ id: 4, status: "ended", ends_at: "2026-11-11T12:00:00.000Z" }),
    makeMockAuction({ id: 5, status: "sold" }),
  ];

  const liveOnly = filterEligible(pool, { now: NOW, liveOnly: true });
  assert.deepEqual(liveOnly.map((a) => a.id), [1]);

  const allEligible = filterEligible(pool, { now: NOW, liveOnly: false });
  // Draft and cancelled never appear; sold and ended survive when liveOnly=false
  assert.ok(!allEligible.some((a) => a.status === "draft" || a.status === "cancelled"));
  assert.ok(allEligible.some((a) => a.id === 1));
});

test("REC-05 similar auctions matches same category or title terms and excludes target item", () => {
  const target = makeMockAuction({ id: 10, title: "iPhone 15 Pro Max 256GB", category: "phones", user: "seller_1" });
  const pool = [
    target,
    makeMockAuction({ id: 11, title: "iPhone 14 Pro 128GB", category: "phones", user: "seller_2" }),
    makeMockAuction({ id: 12, title: "Samsung Galaxy S24 Ultra", category: "phones", user: "seller_3" }),
    makeMockAuction({ id: 13, title: "Solar Inverter 5kVA", category: "solar", user: "seller_4" }),
  ];

  const similar = similarAuctions(target, pool, { now: NOW, limit: 4, liveOnly: true });
  const ids = similar.map((s) => s.item.id);
  assert.ok(!ids.includes(10), "target itself must be excluded");
  assert.ok(ids.includes(11), "same category phone with iPhone term must match");
  assert.ok(ids.includes(12), "same category phone must match");
  assert.ok(!ids.includes(13), "unrelated solar inverter must not appear in similar phones");
});

test("REC-06 more from this seller returns only eligible listings from the same seller", () => {
  const target = makeMockAuction({ id: 20, user: "seller_farai" });
  const pool = [
    target,
    makeMockAuction({ id: 21, user: "seller_farai", title: "Apple Watch Ultra 2" }),
    makeMockAuction({ id: 22, user: "seller_farai", title: "AirPods Pro 2" }),
    makeMockAuction({ id: 23, user: "seller_chipo", title: "Hisense 350L Fridge" }),
  ];

  const sellerItems = moreFromSeller(target, pool, { now: NOW, limit: 5, liveOnly: true });
  assert.equal(sellerItems.length, 2);
  assert.ok(sellerItems.every((it) => it.user === "seller_farai"));
  assert.ok(!sellerItems.some((it) => it.id === 20));
});

test("REC-07 ending soon orders by soonest remaining time without fabricating bids", () => {
  const pool = [
    makeMockAuction({ id: 31, ends_at: "2026-11-12T16:00:00.000Z", bid_count: 0 }),
    makeMockAuction({ id: 32, ends_at: "2026-11-12T13:00:00.000Z", bid_count: 2 }),
    makeMockAuction({ id: 33, ends_at: "2026-11-13T12:00:00.000Z", bid_count: 5 }),
  ];

  const soon = endingSoon(pool, { now: NOW, limit: 3 });
  assert.deepEqual(soon.map((it) => it.id), [32, 31, 33]);
});

test("REC-08 most active orders strictly by real engine bid count", () => {
  const pool = [
    makeMockAuction({ id: 41, bid_count: 0 }),
    makeMockAuction({ id: 42, bid_count: 12 }),
    makeMockAuction({ id: 43, bid_count: 3 }),
  ];

  const active = mostActive(pool, { now: NOW, limit: 3 });
  assert.deepEqual(active.map((it) => it.id), [42, 43], "0-bid auctions must be excluded from most active");
});

test("REC-09 recently started orders by started_at timestamp", () => {
  const pool = [
    makeMockAuction({ id: 51, started_at: "2026-11-10T10:00:00.000Z" }),
    makeMockAuction({ id: 52, started_at: "2026-11-12T10:00:00.000Z" }),
    makeMockAuction({ id: 53, started_at: "2026-11-11T10:00:00.000Z" }),
  ];

  const recent = recentlyStarted(pool, { now: NOW, limit: 3 });
  assert.deepEqual(recent.map((it) => it.id), [52, 53, 51]);
});

test("REC-10 seller diversity cap prevents seller monopoly in recommendations", () => {
  const pool = [
    makeMockAuction({ id: 61, user: "seller_monopoly", title: "Phone 1" }),
    makeMockAuction({ id: 62, user: "seller_monopoly", title: "Phone 2" }),
    makeMockAuction({ id: 63, user: "seller_monopoly", title: "Phone 3" }),
    makeMockAuction({ id: 64, user: "seller_other", title: "Phone 4" }),
    makeMockAuction({ id: 65, user: "seller_third", title: "Phone 5" }),
  ];

  const recs = rankCandidates(pool, { category: "phones" }, { now: NOW, limit: 4, maxPerSeller: 2, liveOnly: true });
  const monopolyCount = recs.filter((r) => r.item.user === "seller_monopoly").length;
  assert.equal(monopolyCount, 2, "seller monopoly must be capped at maxPerSeller=2");
  assert.equal(recs.length, 4);
});

test("REC-11 Home recommendations: history basis vs diverse cold-start fallback", () => {
  const pool = [
    makeMockAuction({ id: 71, category: "solar", title: "Solar Lithium Battery 5kWh" }),
    makeMockAuction({ id: 72, category: "phones", title: "iPhone 13 128GB" }),
    makeMockAuction({ id: 73, category: "tools", title: "Makita Angle Grinder" }),
    makeMockAuction({ id: 74, category: "solar", title: "Solar Panels 550W Tier 1" }),
  ];

  // User with solar history receives history-based recommendations
  const withHistory = recommendedForHome(
    pool,
    { recentQueries: ["solar battery"], viewedCategories: ["solar"] },
    { now: NOW, limit: 4 },
  );
  assert.equal(withHistory.basis, "history");
  assert.ok(withHistory.items[0].item.category === "solar");

  // Cold start (no history) falls back to diverse categories
  const coldStart = recommendedForHome(pool, null, { now: NOW, limit: 4 });
  assert.equal(coldStart.basis, "diverse");
  assert.ok(coldStart.items.length > 0);
});

test("REC-12 search result ranking honours explicit sort options", () => {
  const pool = [
    makeMockAuction({ id: 81, title: "Solar Inverter 3kVA", current_price: 350, bid_count: 2, ends_at: "2026-11-13T10:00:00.000Z" }),
    makeMockAuction({ id: 82, title: "Solar Inverter 5kVA Hybrid", current_price: 600, bid_count: 8, ends_at: "2026-11-12T15:00:00.000Z" }),
    makeMockAuction({ id: 83, title: "Solar Inverter 1kVA Mini", current_price: 150, bid_count: 1, ends_at: "2026-11-14T10:00:00.000Z" }),
  ];

  const byPrice = rankSearchResults("solar inverter", pool, "price_asc", NOW);
  assert.deepEqual(byPrice.map((it) => it.id), [83, 81, 82]);

  const byBids = rankSearchResults("solar inverter", pool, "bids", NOW);
  assert.deepEqual(byBids.map((it) => it.id), [82, 81, 83]);

  const byEnding = rankSearchResults("solar inverter", pool, "ending", NOW);
  assert.deepEqual(byEnding.map((it) => it.id), [82, 81, 83]);
});

test("REC-13 query suggestions from real listing titles, categories and history without fabrication", () => {
  const suggestions = suggestQueries("pix", {
    history: ["pixel 7 case"],
    categories: [{ slug: "phones", label: "Phones & Tablets" }],
    titles: ["Google Pixel 8 Pro Ceramic", "Pixel 8a Charcoal", "iPhone 15 Pro"],
  });

  const texts = suggestions.map((s) => s.text.toLowerCase());
  assert.ok(texts.some((t) => t.includes("pixel")), "real titles must supply suggestions");
  assert.ok(!texts.some((t) => t.includes("samsung")), "unrelated phrases must not appear");
});

test("REC-14 local user store: history isolation between accounts and privacy controls", async () => {
  const store = createUserStore(createInMemoryStorage());

  await store.addSearchQuery("iphone", "user_alice");
  await store.addSearchQuery("macbook", "user_alice");
  await store.addSearchQuery("solar panel", "user_bob");

  const aliceHist = await store.getSearchHistory("user_alice");
  const bobHist = await store.getSearchHistory("user_bob");

  assert.deepEqual(aliceHist, ["macbook", "iphone"], "Alice should have her own searches in MRU order");
  assert.deepEqual(bobHist, ["solar panel"], "Bob should have only his search");
  assert.ok(!bobHist.includes("iphone"), "Alice's search must not leak into Bob's history");

  // Deletion of single query
  await store.removeSearchQuery("iphone", "user_alice");
  const aliceAfterRemove = await store.getSearchHistory("user_alice");
  assert.deepEqual(aliceAfterRemove, ["macbook"]);

  // Clear history
  await store.clearSearchHistory("user_alice");
  const aliceCleared = await store.getSearchHistory("user_alice");
  assert.deepEqual(aliceCleared, []);

  // Personalization preferences
  await store.setUserPreferences({ personalizationEnabled: false, historyEnabled: false });
  const prefs = await store.getUserPreferences();
  assert.equal(prefs.personalizationEnabled, false);
  assert.equal(prefs.historyEnabled, false);

  // Restore defaults
  await store.setUserPreferences({ personalizationEnabled: true, historyEnabled: true });
});
