// TENGASELL-REC-01 — contextual auction recommendation MVP.
//
// A bounded, inspectable, deterministic ranking module. It uses only canonical
// listing metadata already returned by TrailBase (title, description, category,
// seller, prices, bid_count maintained by the trade engine, start/end times)
// plus user-controlled on-device history. There is no model training, no
// hidden behavioural tracking and no server-side profile.
//
// Pipeline: eligibility filter → candidate strategy → explainable scoring →
// relevance-tier ordering → seller-diversity cap → deterministic tie-break.
//
// Relevance always precedes urgency: when a context exists (query, item,
// category or history) candidates are ordered first by relevance tier, so an
// unrelated auction ending soon cannot outrank a strongly matching auction
// merely because its timer is low.

import { deriveListingState } from "./format.ts";
import type { AuctionView } from "./types.ts";

export const RECOMMENDER_VERSION = "tengasell-rec-mvp-1.0.0";

/** Configurable weights. Validated by fixtures in tests/recommendation.test.mjs.
 *  These are Tengasell's own documented starting weights — not any third
 *  party's proprietary values. */
export interface RecommendationWeights {
  /** Query token coverage of the title (0..1). */
  query: number;
  /** Same category as the context (0/1). */
  category: number;
  /** Title token Jaccard similarity to the context item (0..1). */
  title: number;
  /** Same seller as the context item (0/1). */
  seller: number;
  /** Log-price proximity to the context item (0..1). */
  price: number;
  /** Overlap with the user's own recent searches / viewed categories (0..1). */
  history: number;
  /** Engine-maintained bid_count, log-normalised within the pool (0..1). */
  activity: number;
  /** Live and ending within 24h (0..1). */
  urgency: number;
  /** Started within the last 48h — new-listing exploration (0..1). */
  recency: number;
}

export const DEFAULT_WEIGHTS: Readonly<RecommendationWeights> = Object.freeze({
  query: 0.4,
  category: 0.2,
  title: 0.15,
  seller: 0.05,
  price: 0.05,
  history: 0.15,
  activity: 0.04,
  urgency: 0.03,
  recency: 0.02,
});

/** Minimum relevance (before engagement signals) for a candidate to sit in the
 *  "relevant" tier whenever a context is present. */
export const RELEVANCE_FLOOR = 0.12;

export function validateWeights(w: RecommendationWeights): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(w)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) problems.push(`${key} must be within 0..1`);
  }
  const engagement = w.activity + w.urgency + w.recency;
  const relevance = w.query + w.category + w.title + w.seller + w.price + w.history;
  if (engagement >= relevance) problems.push("engagement weights must stay below relevance weights");
  return problems;
}

export type ReasonCode =
  | "query_match"
  | "same_category"
  | "similar_title"
  | "same_seller"
  | "similar_price"
  | "recent_history"
  | "active_bidding"
  | "ending_soon"
  | "new_listing";

export interface ScoreInputs {
  query: number;
  category: number;
  title: number;
  seller: number;
  price: number;
  history: number;
  activity: number;
  urgency: number;
  recency: number;
}

export interface Recommendation {
  item: AuctionView;
  score: number;
  relevance: number;
  tier: 0 | 1;
  reasons: ReasonCode[];
  inputs: ScoreInputs;
}

export interface HistorySignals {
  /** Most-recent-first search phrases, already user-controlled and scoped. */
  recentQueries: readonly string[];
  /** Categories of listings the user actually opened (most recent first). */
  viewedCategories: readonly string[];
}

export interface RecommendationContext {
  query?: string;
  item?: AuctionView | null;
  category?: string;
  history?: HistorySignals | null;
}

export interface EligibilityOptions {
  now: number;
  /** When true only genuinely biddable, unexpired live auctions survive. */
  liveOnly: boolean;
  excludeIds?: Iterable<number>;
}

export interface RankOptions extends EligibilityOptions {
  limit: number;
  /** Maximum items per seller in one module (default 2). */
  maxPerSeller?: number;
  weights?: RecommendationWeights;
  /** Drop candidates below the relevance floor entirely (used by "Similar"). */
  requireRelevance?: boolean;
}

const STOPWORDS = new Set([
  "a", "an", "and", "the", "for", "with", "of", "to", "in", "on", "or", "by",
  "at", "is", "it", "as", "from", "new", "used", "set", "kit",
]);

export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 2 && !STOPWORDS.has(tok));
}

function tokenSet(text: string | null | undefined): Set<string> {
  return new Set(tokenize(text));
}

function tokenMatches(candidate: Set<string>, token: string): boolean {
  if (candidate.has(token)) return true;
  if (token.length < 3) return false;
  for (const value of candidate) {
    if (value.startsWith(token) || (value.length >= 3 && token.startsWith(value))) return true;
  }
  return false;
}

/** Fraction of query tokens found in the title (prefix-tolerant), with a half
 *  credit for tokens that only appear in the description or category. */
export function queryCoverage(query: string, item: Pick<AuctionView, "title" | "description" | "category">): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const title = tokenSet(item.title);
  const secondary = tokenSet(`${item.description ?? ""} ${item.category ?? ""}`);
  let score = 0;
  for (const token of tokens) {
    if (tokenMatches(title, token)) score += 1;
    else if (tokenMatches(secondary, token)) score += 0.5;
  }
  return score / tokens.length;
}

export function titleSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function priceProximity(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  const distance = Math.abs(Math.log(a / b)) / Math.log(4);
  return Math.max(0, 1 - distance);
}

function endsAt(item: AuctionView): number {
  const value = Date.parse(item.ends_at);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/** Step A — eligibility. Removes unpublished (draft/cancelled), malformed,
 *  duplicate and explicitly excluded listings; in live-only contexts also
 *  removes anything not genuinely biddable right now. */
export function filterEligible(pool: readonly AuctionView[], opts: EligibilityOptions): AuctionView[] {
  const excluded = new Set<number>(opts.excludeIds ?? []);
  const seen = new Set<number>();
  const result: AuctionView[] = [];
  for (const item of pool) {
    if (!item || !Number.isFinite(item.id) || seen.has(item.id) || excluded.has(item.id)) continue;
    if (typeof item.title !== "string" || item.title.trim() === "") continue;
    if (item.status === "draft" || item.status === "cancelled") continue;
    const state = deriveListingState(item, opts.now);
    if (opts.liveOnly) {
      if (!state.biddable || !(endsAt(item) > opts.now)) continue;
    } else if (state.availability === "not_live" && item.status !== "live") {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function historyAffinity(item: AuctionView, history: HistorySignals | null | undefined): number {
  if (!history) return 0;
  let best = 0;
  history.recentQueries.slice(0, 5).forEach((q, index) => {
    const coverage = queryCoverage(q, item);
    best = Math.max(best, coverage * (1 - index * 0.1));
  });
  const categoryIndex = history.viewedCategories.slice(0, 6).indexOf(item.category);
  if (categoryIndex >= 0) best = Math.max(best, 0.8 - categoryIndex * 0.1);
  return Math.max(0, Math.min(1, best));
}

/** Step C — explainable score for one candidate. */
export function scoreCandidate(
  item: AuctionView,
  ctx: RecommendationContext,
  now: number,
  maxBids: number,
  weights: RecommendationWeights = DEFAULT_WEIGHTS,
): { score: number; relevance: number; inputs: ScoreInputs; reasons: ReasonCode[] } {
  const target = ctx.item ?? null;
  const contextCategory = ctx.category ?? target?.category;
  const inputs: ScoreInputs = {
    query: ctx.query ? queryCoverage(ctx.query, item) : 0,
    category: contextCategory && item.category === contextCategory ? 1 : 0,
    title: target ? titleSimilarity(target.title, item.title) : 0,
    seller: target && item.user === target.user ? 1 : 0,
    price: target ? priceProximity(target.current_price, item.current_price) : 0,
    history: historyAffinity(item, ctx.history),
    activity: maxBids > 0 ? Math.log1p(Math.max(0, item.bid_count)) / Math.log1p(maxBids) : 0,
    urgency: 0,
    recency: 0,
  };
  const state = deriveListingState(item, now);
  const remaining = endsAt(item) - now;
  if (state.biddable && remaining > 0 && remaining < 24 * 3600_000) {
    inputs.urgency = 1 - remaining / (24 * 3600_000);
  }
  const started = Date.parse(item.started_at);
  if (Number.isFinite(started) && now - started >= 0 && now - started < 48 * 3600_000) {
    inputs.recency = 1 - (now - started) / (48 * 3600_000);
  }

  // Price proximity alone must not make an unrelated listing look "similar".
  const priceTerm = inputs.category || inputs.title > 0 ? inputs.price : 0;
  const relevance =
    weights.query * inputs.query +
    weights.category * inputs.category +
    weights.title * inputs.title +
    weights.seller * inputs.seller +
    weights.price * priceTerm +
    weights.history * inputs.history;
  const engagement =
    weights.activity * inputs.activity +
    weights.urgency * inputs.urgency +
    weights.recency * inputs.recency;

  const reasons: ReasonCode[] = [];
  if (inputs.query >= 0.5) reasons.push("query_match");
  if (inputs.category) reasons.push("same_category");
  if (inputs.title >= 0.2) reasons.push("similar_title");
  if (inputs.seller) reasons.push("same_seller");
  if (priceTerm >= 0.6) reasons.push("similar_price");
  if (inputs.history >= 0.4) reasons.push("recent_history");
  if (item.bid_count > 0 && inputs.activity >= 0.5) reasons.push("active_bidding");
  if (inputs.urgency >= 0.75) reasons.push("ending_soon");
  if (inputs.recency >= 0.5) reasons.push("new_listing");

  return {
    score: Math.round((relevance + engagement) * 1e6) / 1e6,
    relevance: Math.round(relevance * 1e6) / 1e6,
    inputs,
    reasons,
  };
}

function hasContext(ctx: RecommendationContext): boolean {
  return Boolean(
    (ctx.query && tokenize(ctx.query).length) ||
      ctx.item ||
      ctx.category ||
      (ctx.history && (ctx.history.recentQueries.length || ctx.history.viewedCategories.length)),
  );
}

/** Deterministic ordering: relevance tier, score, sooner end, lower id. */
export function compareRecommendations(a: Recommendation, b: Recommendation): number {
  if (a.tier !== b.tier) return b.tier - a.tier;
  if (a.score !== b.score) return b.score - a.score;
  const endA = endsAt(a.item);
  const endB = endsAt(b.item);
  if (endA !== endB) return endA - endB;
  return a.item.id - b.item.id;
}

function applySellerCap(sorted: Recommendation[], limit: number, maxPerSeller: number): Recommendation[] {
  const counts = new Map<string, number>();
  const picked: Recommendation[] = [];
  for (const rec of sorted) {
    if (picked.length >= limit) break;
    const seller = rec.item.user || rec.item.seller_username;
    const count = counts.get(seller) ?? 0;
    if (count >= maxPerSeller) continue;
    counts.set(seller, count + 1);
    picked.push(rec);
  }
  return picked;
}

/** Generic ranker used by every strategy. */
export function rankCandidates(
  pool: readonly AuctionView[],
  ctx: RecommendationContext,
  opts: RankOptions,
): Recommendation[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const eligible = filterEligible(pool, {
    now: opts.now,
    liveOnly: opts.liveOnly,
    excludeIds: [...(opts.excludeIds ?? []), ...(ctx.item ? [ctx.item.id] : [])],
  });
  const maxBids = eligible.reduce((max, item) => Math.max(max, item.bid_count || 0), 0);
  const contextual = hasContext(ctx);
  const scored: Recommendation[] = eligible.map((item) => {
    const result = scoreCandidate(item, ctx, opts.now, maxBids, weights);
    return {
      item,
      score: result.score,
      relevance: result.relevance,
      tier: !contextual || result.relevance >= RELEVANCE_FLOOR ? 1 : 0,
      reasons: result.reasons,
      inputs: result.inputs,
    };
  });
  const filtered = opts.requireRelevance ? scored.filter((rec) => rec.tier === 1) : scored;
  filtered.sort(compareRecommendations);
  return applySellerCap(filtered, opts.limit, opts.maxPerSeller ?? 2);
}

// ── Strategies (Step B) ──────────────────────────────────────────────────

export function similarAuctions(
  target: AuctionView,
  pool: readonly AuctionView[],
  opts: Omit<RankOptions, "requireRelevance">,
): Recommendation[] {
  // "Similar" means same category or genuinely overlapping title terms; the
  // same seller is surfaced separately in "More from this seller".
  return rankCandidates(
    pool.filter((item) => item.user !== target.user || item.category === target.category),
    { item: target },
    { ...opts, requireRelevance: true },
  ).filter((rec) => rec.inputs.category === 1 || rec.inputs.title > 0);
}

export function moreFromSeller(
  target: AuctionView,
  pool: readonly AuctionView[],
  opts: Pick<RankOptions, "now" | "limit" | "liveOnly">,
): AuctionView[] {
  return filterEligible(
    pool.filter((item) => item.user === target.user),
    { now: opts.now, liveOnly: opts.liveOnly, excludeIds: [target.id] },
  )
    .sort((a, b) => endsAt(a) - endsAt(b) || a.id - b.id)
    .slice(0, opts.limit);
}

export function endingSoon(pool: readonly AuctionView[], opts: Pick<RankOptions, "now" | "limit" | "excludeIds">): AuctionView[] {
  return filterEligible(pool, { now: opts.now, liveOnly: true, excludeIds: opts.excludeIds })
    .sort((a, b) => endsAt(a) - endsAt(b) || a.id - b.id)
    .slice(0, opts.limit);
}

/** Only auctions with real engine-recorded bids; never padded. */
export function mostActive(pool: readonly AuctionView[], opts: Pick<RankOptions, "now" | "limit" | "excludeIds">): AuctionView[] {
  return filterEligible(pool, { now: opts.now, liveOnly: true, excludeIds: opts.excludeIds })
    .filter((item) => item.bid_count > 0)
    .sort((a, b) => b.bid_count - a.bid_count || endsAt(a) - endsAt(b) || a.id - b.id)
    .slice(0, opts.limit);
}

export function recentlyStarted(pool: readonly AuctionView[], opts: Pick<RankOptions, "now" | "limit" | "excludeIds">): AuctionView[] {
  const started = (item: AuctionView) => {
    const value = Date.parse(item.started_at);
    return Number.isFinite(value) ? value : 0;
  };
  return filterEligible(pool, { now: opts.now, liveOnly: true, excludeIds: opts.excludeIds })
    .sort((a, b) => started(b) - started(a) || a.id - b.id)
    .slice(0, opts.limit);
}

export type HomeRecommendationBasis = "history" | "diverse";

/** Step D — Home "Recommended live auctions". Uses permitted history when the
 *  user has enabled personalization and history exists; otherwise falls back
 *  to a category-diverse selection ordered by real remaining time. Never
 *  invents interests. */
export function recommendedForHome(
  pool: readonly AuctionView[],
  history: HistorySignals | null,
  opts: Pick<RankOptions, "now" | "limit" | "excludeIds" | "maxPerSeller">,
): { basis: HomeRecommendationBasis; items: Recommendation[] } {
  const usable =
    history && (history.recentQueries.length > 0 || history.viewedCategories.length > 0) ? history : null;
  if (usable) {
    const ranked = rankCandidates(pool, { history: usable }, { ...opts, liveOnly: true, requireRelevance: true });
    if (ranked.length > 0) return { basis: "history", items: ranked };
  }
  return { basis: "diverse", items: diverseLive(pool, opts) };
}

/** Round-robin across categories (sooner-ending first inside each category). */
export function diverseLive(
  pool: readonly AuctionView[],
  opts: Pick<RankOptions, "now" | "limit" | "excludeIds" | "maxPerSeller">,
): Recommendation[] {
  const eligible = filterEligible(pool, { now: opts.now, liveOnly: true, excludeIds: opts.excludeIds }).sort(
    (a, b) => endsAt(a) - endsAt(b) || a.id - b.id,
  );
  const byCategory = new Map<string, AuctionView[]>();
  for (const item of eligible) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  const order = [...byCategory.keys()].sort((a, b) => {
    const firstA = endsAt(byCategory.get(a)![0]);
    const firstB = endsAt(byCategory.get(b)![0]);
    return firstA - firstB || a.localeCompare(b);
  });
  const interleaved: AuctionView[] = [];
  let added = true;
  for (let round = 0; added; round += 1) {
    added = false;
    for (const key of order) {
      const item = byCategory.get(key)![round];
      if (item) {
        interleaved.push(item);
        added = true;
      }
    }
  }
  const maxBids = eligible.reduce((max, item) => Math.max(max, item.bid_count || 0), 0);
  const recs: Recommendation[] = interleaved.map((item) => {
    const result = scoreCandidate(item, {}, opts.now, maxBids);
    return { item, score: result.score, relevance: 0, tier: 1, reasons: result.reasons, inputs: result.inputs };
  });
  return applySellerCap(recs, opts.limit, opts.maxPerSeller ?? 2);
}

// ── Search helpers ───────────────────────────────────────────────────────

export type SearchSort = "relevance" | "ending" | "price_asc" | "bids";

/** Rank canonical search results. Relevance is never overridden by commercial
 *  placement; explicit sort choices are honoured exactly. */
export function rankSearchResults(
  query: string,
  pool: readonly AuctionView[],
  sort: SearchSort,
  now: number,
): AuctionView[] {
  const eligible = filterEligible(pool, { now, liveOnly: true });
  const tokens = tokenize(query);
  const withCoverage = eligible
    .map((item) => ({ item, coverage: tokens.length ? queryCoverage(query, item) : 1 }))
    .filter((row) => row.coverage >= (tokens.length > 1 ? 0.5 : 0.01));
  const cmpEnd = (a: AuctionView, b: AuctionView) => endsAt(a) - endsAt(b) || a.id - b.id;
  switch (sort) {
    case "ending":
      return withCoverage.map((r) => r.item).sort(cmpEnd);
    case "price_asc":
      return withCoverage.map((r) => r.item).sort((a, b) => a.current_price - b.current_price || cmpEnd(a, b));
    case "bids":
      return withCoverage.map((r) => r.item).sort((a, b) => b.bid_count - a.bid_count || cmpEnd(a, b));
    default:
      return withCoverage
        .sort((a, b) => b.coverage - a.coverage || cmpEnd(a.item, b.item))
        .map((r) => r.item);
  }
}

/** The most specific (longest) token, used as a canonical fallback query when a
 *  multi-word phrase does not appear verbatim in any title. */
export function primarySearchToken(query: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  return [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

export interface QuerySuggestion {
  text: string;
  source: "history" | "category" | "listing";
}

/** Suggestions derived only from the user's own history, real category names
 *  and real listing titles. Nothing is invented to fill space. */
export function suggestQueries(
  input: string,
  sources: {
    history: readonly string[];
    categories: readonly { slug: string; label: string }[];
    titles: readonly string[];
  },
  limit = 6,
): QuerySuggestion[] {
  const needle = input.trim().toLowerCase();
  if (needle.length < 2) return [];
  const lastWord = needle.split(/\s+/).pop() ?? needle;
  const out: QuerySuggestion[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: QuerySuggestion["source"]) => {
    const key = text.trim().toLowerCase();
    if (!key || key === needle || seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push({ text: text.trim(), source });
  };

  for (const entry of sources.history) {
    if (entry.toLowerCase().includes(needle)) push(entry, "history");
  }
  for (const category of sources.categories) {
    if (category.label.toLowerCase().includes(needle) || category.slug.includes(needle)) {
      push(category.label, "category");
    }
  }
  const frequency = new Map<string, number>();
  for (const title of sources.titles) {
    const tokens = tokenize(title);
    tokens.forEach((token, index) => {
      if (!token.startsWith(lastWord)) return;
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
      const next = tokens[index + 1];
      if (next) {
        const bigram = `${token} ${next}`;
        frequency.set(bigram, (frequency.get(bigram) ?? 0) + 1);
      }
    });
  }
  [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .forEach(([text]) => push(text, "listing"));
  return out;
}

/** Limit repeated exposure across nearby sections: returns ids already shown. */
export function idsOf(items: readonly (AuctionView | Recommendation)[]): number[] {
  return items.map((entry) => ("item" in entry ? entry.item.id : entry.id));
}
