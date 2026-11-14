"use client";

// Tengasell remote adapter — TrailBase (Rust, port 3001) REST records API
// + auth API, with trading writes routed through the socket.io trade engine
// (port 3002) for server-side validation (proxy bids, anti-snipe, SLA).
//
// All browser requests go through the gateway using ?XTransformPort=3001.

import { slugify } from "@/lib/tengasell/format";
import { rpc } from "../socket";
import type {
  Auction,
  AuctionEvent,
  AuctionEventBundle,
  AuctionQuery,
  Bid,
  Category,
  CurrentUser,
  LiveSession,
  Message,
  Notification,
  Offer,
  Order,
  Paginated,
  Payment,
  Profile,
  ProductIntakeSession,
  ProductSchemaBundle,
  PublicProductBundle,
  Question,
  Rating,
  RunListCommandInput,
  SavedSearch,
  SaveSearchInput,
  Thread,
  VehicleBundle,
  VehicleIntakeInput,
  VehicleInspection,
  VehicleFinding,
  VehicleDocument,
  CategoryFilterMetadata,
  ProductComparisonResponse,
  SavedSearchFacet,
} from "../types";

const TB = 3001;

const AUTH_KEY = "ts_auth";

interface StoredAuth {
  token: string;
  username: string;
}

function tbUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("XTransformPort", String(TB));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function tbFetch(
  path: string,
  init?: RequestInit & { params?: Record<string, string | number | undefined> },
): Promise<Response> {
  const { params, ...rest } = init ?? {};
  const res = await fetch(tbUrl(path, params), {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return res;
}

/** Encode filter params in TrailBase bracket syntax. */
function filterParams(q: AuctionQuery): Record<string, string> {
  const p: Record<string, string> = {};
  const set = (col: string, op: string, val: string | number) =>
    (p[`filter[${col}][$${op}]`] = String(val));
  if (q.status && q.status !== "all") set("status", "eq", q.status);
  if (q.category) set("category", "eq", q.category);
  if (q.seller) set("seller_username", "eq", q.seller);
  if (q.search) set("title", "like", `%${q.search}%`);
  if (q.condition) set("condition", "eq", q.condition);
  if (q.city) set("city", "eq", q.city);
  if (q.featured) set("featured", "eq", 1);
  if (q.minPrice != null) set("current_price", "gte", q.minPrice);
  if (q.maxPrice != null) set("current_price", "lte", q.maxPrice);
  if (q.endingWithinMinutes != null) {
    set("ends_at", "gte", new Date().toISOString());
    set(
      "ends_at",
      "lte",
      new Date(Date.now() + q.endingWithinMinutes * 60_000).toISOString(),
    );
  }
  return p;
}

function orderParam(q: AuctionQuery): string {
  switch (q.order ?? "ending") {
    case "newest":
      return "-created_at";
    case "price_asc":
      return "current_price";
    case "price_desc":
      return "-current_price";
    case "bids":
      return "-bid_count";
    case "hot":
      return "-views";
    default:
      return "ends_at";
  }
}

function decodeJwtPayload(token: string): { username?: string; admin?: boolean } {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) {
    if (res.status === 401 || res.status === 403) return "You are not allowed to do that (or your session expired — sign in again).";
    return `Request failed (${res.status}).`;
  }
  try {
    const j = JSON.parse(text);
    return j.message ?? j.error ?? text.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

export class RemoteApi {
  private stored: StoredAuth | null = null;
  private cachedUser: CurrentUser | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) this.stored = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  private token(): string | null {
    return this.stored?.token ?? null;
  }

  private authHeaders(): Record<string, string> {
    const t = this.token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  private saveAuth(a: StoredAuth | null) {
    this.stored = a;
    this.cachedUser = null;
    try {
      if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Adopt a session established outside this module (the gated sign-in in
   * auth-shared.tsx: password → suspension gate → MFA → adoption). Updates
   * the in-memory auth state the same way login() does so currentUser()
   * sees the session WITHOUT a page reload.
   */
  adoptExternalSession(a: StoredAuth) {
    this.saveAuth(a);
  }

  /** Drop the in-memory + stored session (used by the gated sign-out). */
  clearExternalSession() {
    this.saveAuth(null);
  }

  // ── auth ────────────────────────────────────────────────────────
  async register(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await tbFetch("/api/auth/v1/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        password_repeat: password,
      }),
    });
    if (res.status === 400) {
      const msg = await errorMessage(res);
      if (/exist/i.test(msg)) return { ok: false, error: "That username is already registered." };
      return { ok: false, error: msg };
    }
    if (!res.ok) return { ok: false, error: await errorMessage(res) };
    return { ok: true };
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string; user?: CurrentUser }> {
    const res = await tbFetch("/api/auth/v1/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 401)
        return { ok: false, error: "Incorrect username or password." };
      return { ok: false, error: await errorMessage(res) };
    }
    const data = await res.json();
    const payload = decodeJwtPayload(data.auth_token ?? "");
    const uname = payload.username ?? username;
    this.saveAuth({ token: data.auth_token, username: uname });
    const user = await this.ensureProfile(uname, !!payload.admin);
    return { ok: true, user };
  }

  async logout(): Promise<void> {
    try {
      await tbFetch("/api/auth/v1/logout", { method: "POST", headers: this.authHeaders() });
    } catch {
      /* best effort */
    }
    this.saveAuth(null);
  }

  /** Refresh token via /status and make sure a profile row exists. */
  private async ensureProfile(username: string, admin: boolean): Promise<CurrentUser> {
    // refresh + validate session
    try {
      const status = await tbFetch("/api/auth/v1/status", { headers: this.authHeaders() });
      if (status.ok) {
        const data = await status.json();
        if (data.auth_token) {
          this.saveAuth({ token: data.auth_token, username });
        }
      } else if (status.status === 401 || status.status === 403) {
        this.saveAuth(null);
        throw new Error("Session expired. Please sign in again.");
      }
    } catch (e) {
      if (e instanceof Error && /Session expired/.test(e.message)) throw e;
    }
    // fetch profile
    const prof = await this.fetchProfileByUsername(username);
    if (prof) {
      this.cachedUser = {
        id: prof.user,
        username,
        token: this.token() ?? "",
        admin,
        profile: prof,
      };
      return this.cachedUser;
    }
    // create profile (autofill fills `user`)
    const create = await tbFetch("/api/records/v1/profiles", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        username,
        display_name: username,
        bio: "New to Tengasell.",
        city: "",
        joined_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      }),
    });
    if (create.ok) {
      const prof2 = await this.fetchProfileByUsername(username);
      if (prof2) {
        this.cachedUser = { id: prof2.user, username, token: this.token() ?? "", admin, profile: prof2 };
        return this.cachedUser;
      }
    }
    this.cachedUser = { id: "", username, token: this.token() ?? "", admin, profile: null };
    return this.cachedUser;
  }

  private async fetchProfileByUsername(username: string): Promise<Profile | null> {
    const res = await tbFetch("/api/records/v1/profiles", {
      params: { [`filter[username][$eq]`]: username, limit: 1 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.records?.[0] ?? null;
  }

  async currentUser(): Promise<CurrentUser | null> {
    if (!this.stored) return null;
    if (this.cachedUser) return this.cachedUser;
    try {
      // restore the admin role from the stored JWT — a hard-coded false here
      // locked admins out of the admin console on every cold boot/reload.
      const token = this.token() ?? "";
      return await this.ensureProfile(this.stored.username, !!decodeJwtPayload(token).admin);
    } catch {
      this.saveAuth(null);
      return null;
    }
  }

  // ── catalog ─────────────────────────────────────────────────────
  async categories(): Promise<Category[]> {
    const res = await tbFetch("/api/records/v1/categories", {
      params: { order: "sort", limit: 100 },
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return data.records ?? [];
  }

  async auctions(q: AuctionQuery = {}): Promise<Paginated<Auction>> {
    const activeFacets: Record<string, unknown> = {};
    if (q.facets) {
      for (const [k, v] of Object.entries(q.facets)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          activeFacets[k] = v;
        }
      }
    }
    const hasPiFilter = Boolean(
      q.make ||
        q.model ||
        q.minYear != null ||
        q.maxYear != null ||
        q.minKm != null ||
        q.maxKm != null ||
        q.bodyType ||
        q.fuel ||
        q.transmission ||
        q.drivetrain ||
        q.exteriorColour ||
        q.inspectionGrade ||
        q.vehicleClass ||
        Object.keys(activeFacets).length > 0,
    );

    if (hasPiFilter) {
      const searchOrder =
        q.order === "price_asc" || q.order === "price_desc" || q.order === "newest" || q.order === "ending"
          ? q.order
          : "ending";
      const searchInput: Record<string, unknown> = {
        status: q.status ?? "live",
        order: searchOrder,
        limit: q.limit ?? 24,
        offset: q.offset ?? 0,
      };
      if (q.search) searchInput.search = q.search;
      if (q.category) searchInput.categoryKey = q.category;
      if (q.city) searchInput.city = q.city;
      if (q.condition) searchInput.condition = q.condition;
      if (q.minPrice != null) searchInput.minPrice = q.minPrice;
      if (q.maxPrice != null) searchInput.maxPrice = q.maxPrice;
      if (q.minYear != null) searchInput.minYear = q.minYear;
      if (q.maxYear != null) searchInput.maxYear = q.maxYear;
      if (q.minKm != null) searchInput.minMileage = q.minKm;
      if (q.maxKm != null) searchInput.maxMileage = q.maxKm;
      if (q.make) searchInput.make = q.make;
      if (q.model) searchInput.model = q.model;
      if (q.vehicleClass) searchInput.vehicleClass = q.vehicleClass;
      if (q.bodyType) searchInput.bodyType = q.bodyType;
      if (q.fuel) searchInput.fuel = q.fuel;
      if (q.transmission) searchInput.transmission = q.transmission;
      if (q.drivetrain) searchInput.drivetrain = q.drivetrain;
      if (q.exteriorColour) searchInput.colour = q.exteriorColour;
      if (q.inspectionGrade) searchInput.inspectionGrade = q.inspectionGrade;
      if (q.endingWithinMinutes != null) searchInput.endingWithinMinutes = q.endingWithinMinutes;
      if (Object.keys(activeFacets).length > 0) searchInput.facets = activeFacets;

      let searchData: { items?: any[]; total?: number } | null = null;
      try {
        const res = await rpc<{ ok: boolean; items?: any[]; total?: number }>(
          "product:search:query",
          { query: searchInput },
        );
        if (res?.ok && Array.isArray(res.items)) {
          searchData = res;
        }
      } catch {
        /* fallback to HTTP /api/pi/search */
      }

      if (!searchData) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(searchInput)) {
          if (v === undefined || v === null || v === "") continue;
          if (k === "categoryKey") qs.set("category", String(v));
          else if (k === "facets") qs.set("facets", JSON.stringify(v));
          else qs.set(k, String(v));
        }
        const httpRes = await fetch(`/api/pi/search?${qs.toString()}`);
        if (!httpRes.ok) throw new Error(await errorMessage(httpRes));
        searchData = await httpRes.json();
      }

      const rawItems = searchData?.items ?? [];
      const hydrated = await Promise.all(
        rawItems.map(async (item: any) => {
          const aid = Number(item.auction_id ?? item.id ?? 0);
          const pub = aid > 0 ? await this.auction(aid).catch(() => null) : null;
          if (!pub) return null;
          if (q.seller && pub.seller_username !== q.seller) return null;
          return {
            ...pub,
            year: item.year ?? pub.year ?? null,
            mileage: item.mileage ?? pub.mileage ?? null,
            fuel: item.fuel ?? pub.fuel ?? null,
            transmission: item.transmission ?? pub.transmission ?? null,
            inspection_grade: item.inspection_grade ?? pub.inspection_grade ?? null,
            make: item.make ?? pub.make ?? null,
            model: item.model ?? pub.model ?? null,
            body_type: item.body_type ?? pub.body_type ?? null,
          } as Auction;
        }),
      );
      const items = hydrated.filter((x): x is Auction => x !== null);
      return { items, total: q.seller ? items.length : (searchData?.total ?? items.length) };
    }

    const params: Record<string, string | number> = {
      ...filterParams(q),
      order: orderParam(q),
      limit: q.limit ?? 24,
      offset: q.offset ?? 0,
      count: "true",
    };
    const res = await tbFetch("/api/records/v1/auction_public", { params });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return { items: data.records ?? [], total: data.total_count ?? data.records?.length ?? 0 };
  }

  async auction(id: number): Promise<Auction | null> {
    const res = await tbFetch(`/api/records/v1/auction_public/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorMessage(res));
    return await res.json();
  }

  async bids(auctionId: number): Promise<Bid[]> {
    const res = await tbFetch("/api/records/v1/bids", {
      params: { [`filter[auction_id][$eq]`]: auctionId, order: "-id", limit: 100 },
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return data.records ?? [];
  }

  async questions(auctionId: number): Promise<Question[]> {
    const res = await tbFetch("/api/records/v1/questions", {
      params: { [`filter[auction_id][$eq]`]: auctionId, order: "id", limit: 100 },
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return data.records ?? [];
  }

  async suggest(term: string): Promise<{ id: number; title: string; current_price: number }[]> {
    if (!term.trim()) return [];
    const res = await tbFetch("/api/records/v1/auction_public", {
      params: { [`filter[title][$like]`]: `%${term}%`, [`filter[status][$eq]`]: "live", limit: 6 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.records ?? []).map((a: Auction) => ({
      id: a.id,
      title: a.title,
      current_price: a.current_price,
    }));
  }

  async profile(username: string): Promise<Profile | null> {
    return this.fetchProfileByUsername(username);
  }

  async ratingsFor(username: string): Promise<Rating[]> {
    const res = await tbFetch("/api/records/v1/ratings", {
      params: { [`filter[ratee_username][$eq]`]: username, order: "-created_at", limit: 50 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  // ── watchlist (direct TrailBase REST — agent-friendly) ──────────
  async watchState(auctionId: number): Promise<boolean> {
    if (!this.token()) return false;
    const res = await tbFetch("/api/records/v1/watchlist", {
      headers: this.authHeaders(),
      params: { [`filter[auction_id][$eq]`]: auctionId, limit: 1 },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.records ?? []).length > 0;
  }

  async watch(auctionId: number, on: boolean): Promise<void> {
    if (!this.cachedUser && !(await this.currentUser()))
      throw new Error("Sign in to watch auctions.");
    if (on) {
      const res = await tbFetch("/api/records/v1/watchlist", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          user: this.cachedUser?.id,
          auction_id: auctionId,
          created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
    } else {
      const res = await tbFetch("/api/records/v1/watchlist", {
        headers: this.authHeaders(),
        params: { [`filter[auction_id][$eq]`]: auctionId, limit: 1 },
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = await res.json();
      const row = data.records?.[0];
      if (row) {
        await tbFetch(`/api/records/v1/watchlist/${row.id}`, {
          method: "DELETE",
          headers: this.authHeaders(),
        });
      }
    }
  }

  async watchlist(): Promise<Auction[]> {
    if (!this.token()) return [];
    const res = await tbFetch("/api/records/v1/watchlist", {
      headers: this.authHeaders(),
      params: { order: "-id", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const ids: number[] = (data.records ?? []).map((w: { auction_id: number }) => w.auction_id);
    const out: Auction[] = [];
    for (const id of ids) {
      const a = await this.auction(id);
      if (a) out.push(a);
    }
    return out;
  }

  // ── trading actions via the socket.io trade engine (validated) ───
  async placeBid(auctionId: number, maxAmount: number) {
    return rpc<{ ok: boolean; error?: string; auction?: Auction; amount?: number; winning?: boolean; outbid?: boolean }>(
      "bid:place",
      { auctionId, maxAmount, commandId: globalThis.crypto.randomUUID() },
    );
  }

  async buyNow(auctionId: number, address?: string | null): Promise<{ orderId: number }> {
    const res = await rpc<{ ok: boolean; error?: string; orderId?: number; order?: Order }>(
      "buynow:purchase",
      { auctionId, address: address ?? null, commandId: globalThis.crypto.randomUUID() },
    );
    return { orderId: res.orderId ?? res.order?.id ?? 0 };
  }

  async askQuestion(auctionId: number, body: string): Promise<Question> {
    const res = await rpc<{ ok: boolean; error?: string; question?: Question }>("question:ask", {
      auctionId,
      body,
    });
    if (!res.question) throw new Error("Could not post question.");
    return res.question;
  }

  async answerQuestion(questionId: number, body: string): Promise<Question> {
    const res = await rpc<{ ok: boolean; error?: string; question?: Question }>(
      "question:answer",
      { questionId, body },
    );
    if (!res.question) throw new Error("Could not answer question.");
    return res.question;
  }

  async sendMessage(input: {
    threadId?: number;
    auctionId?: number;
    toUsername?: string;
    body: string;
  }): Promise<{ message: Message; thread: Thread }> {
    const res = await rpc<{ ok: boolean; error?: string; message?: Message; thread?: Thread }>(
      "message:send",
      input,
    );
    if (!res.message || !res.thread) throw new Error("Could not send message.");
    return { message: res.message, thread: res.thread };
  }

  // ── selling ─────────────────────────────────────────────────────
  async createAuction(input: {
    title: string;
    description: string;
    category: string;
    condition: string;
    start_price: number;
    buy_now_price?: number | null;
    reserve_price?: number | null;
    shipping_fee: number;
    shipping: string;
    city: string;
    durationHours: number;
    images: string[];
    featured?: number;
    /** IMP-04: category vehicles must explicitly be a whole vehicle or a part. */
    assetKind?: "general" | "vehicle" | "part";
    /** Gap-8: accept Best-Offer on this listing. */
    allowOffers?: boolean;
    /** Gap-8: auto-decline offers below this minimum (US$). */
    offerMin?: number | null;
  }): Promise<Auction> {
    if (!this.cachedUser && !(await this.currentUser()))
      throw new Error("Sign in to sell on Tengasell.");
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const payload = {
      user: this.cachedUser?.id,
      seller_username: this.cachedUser?.username,
      title: input.title.trim(),
      slug: slugify(input.title),
      description: input.description.trim(),
      category: input.category,
      condition: input.condition,
      start_price: input.start_price,
      current_price: input.start_price,
      buy_now_price: input.buy_now_price ?? null,
      reserve_price: input.reserve_price ?? null,
      reserve_disclosure:
        input.assetKind === "vehicle"
          ? input.reserve_price == null
            ? "NO_RESERVE"
            : "RESERVE_APPLIES"
          : undefined,
      bid_count: 0,
      watch_count: 0,
      views: 0,
      shipping_fee: input.shipping_fee ?? 0,
      shipping: input.shipping,
      city: input.city ?? "",
      ends_at: new Date(Date.now() + input.durationHours * 3600_000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z"),
      started_at: now,
      status: input.assetKind === "vehicle" ? "draft" : "live",
      extension_count: 0,
      asset_kind: input.assetKind ?? "general",
      featured: input.featured ?? 0,
      allow_offers: input.allowOffers ? 1 : 0,
      offer_min: input.offerMin ?? null,
      images: JSON.stringify(input.images.slice(0, 4)),
      created_at: now,
      updated_at: now,
    };
    const res = await tbFetch("/api/records/v1/auctions", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    const id = Number(data.ids?.[0] ?? 0);
    const created = await this.auction(id);
    if (!created) throw new Error("Listing created but could not be read back.");
    return created;
  }

  // ── IMP-04 Vehicle / Tengasell Inspection ───────────────────────
  async productSchema(categoryKey?: string): Promise<ProductSchemaBundle> {
    const res = await rpc<{ ok: boolean; schema?: ProductSchemaBundle }>("product:schema:get", { categoryKey });
    if (!res.schema) throw new Error("Product schema could not be loaded.");
    return res.schema;
  }

  async publicProductForAuction(auctionId: number): Promise<PublicProductBundle> {
    const res = await rpc<{ ok: boolean; bundle?: PublicProductBundle }>("product:public:get", { auctionId });
    if (!res.bundle) throw new Error("Public product details could not be loaded.");
    return res.bundle;
  }

  async categoryFilters(categoryKey?: string): Promise<CategoryFilterMetadata> {
    try {
      const res = await rpc<{ ok: boolean; metadata?: CategoryFilterMetadata }>("product:filters:get", { categoryKey });
      if (res?.metadata) return res.metadata;
    } catch {
      /* fallback */
    }
    const targetKey = categoryKey || "VEHICLE_PASSENGER_CAR";
    const httpRes = await fetch(`/api/pi/categories/${encodeURIComponent(targetKey)}/filters`);
    if (httpRes.ok) {
      const data = await httpRes.json();
      if (data.ok) return data;
    }
    throw new Error("Could not load category filter metadata.");
  }

  async compareProducts(auctionIds: number[]): Promise<ProductComparisonResponse> {
    try {
      const res = await rpc<{ ok: boolean; comparison?: ProductComparisonResponse; error?: string }>(
        "product:compare",
        { auctionIds },
      );
      if (res?.ok && res.comparison) return res.comparison;
      if (res && res.ok === false) {
        throw new Error(res.error || "Could not compare products.");
      }
    } catch (err: any) {
      if (err?.message && !String(err.message).toLowerCase().includes("not connected") && !String(err.message).toLowerCase().includes("timeout")) {
        // Re-throw explicit validation/policy errors from the RPC handler; fall through to HTTP only on transport failure
        if (/compare|listing|distinct|at least|at most|public/i.test(String(err.message))) {
          throw err;
        }
      }
    }
    const httpRes = await fetch("/api/pi/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auctionIds }),
    });
    const data = await httpRes.json().catch(() => ({}));
    if (httpRes.ok && data.ok && data.comparison) return data.comparison;
    throw new Error(data.error || "Could not compare products.");
  }

  async openProductIntake(input: {
    categoryKey: string;
    title: string;
    description: string;
    condition: string;
    start_price: number;
    buy_now_price?: number | null;
    reserve_price?: number | null;
    shipping_fee?: number;
    shipping: string;
    city: string;
    durationHours: number;
    images: string[];
    allowOffers?: boolean;
    offerMin?: number | null;
  }): Promise<{ auction: Auction; session: ProductIntakeSession; schema: ProductSchemaBundle }> {
    const now = Date.now();
    const res = await rpc<{
      ok: boolean; auction?: Auction; session?: ProductIntakeSession; schema?: ProductSchemaBundle;
    }>("product:intake:open", {
      intake: {
        commandId: globalThis.crypto.randomUUID(),
        categoryKey: input.categoryKey,
        title: input.title,
        slug: slugify(input.title) + "-" + now.toString(36),
        description: input.description,
        condition: input.condition,
        start_price: input.start_price,
        buy_now_price: input.buy_now_price ?? null,
        reserve_price: input.reserve_price ?? null,
        shipping_fee: input.shipping_fee ?? 0,
        shipping: input.shipping,
        city: input.city,
        ends_at: new Date(now + input.durationHours * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"),
        images: input.images,
        allow_offers: !!input.allowOffers,
        offer_min: input.offerMin ?? null,
      },
    });
    if (!res.auction || !res.session || !res.schema) throw new Error("Product intake could not be opened.");
    return { auction: res.auction, session: res.session, schema: res.schema };
  }

  async productIntakeSession(auctionId: number): Promise<{ session: ProductIntakeSession; steps: Record<string, unknown>[] }> {
    const res = await rpc<{ ok: boolean; session?: ProductIntakeSession; steps?: Record<string, unknown>[] }>(
      "product:intake:get", { auctionId },
    );
    if (!res.session) throw new Error("Product intake session could not be loaded.");
    return { session: res.session, steps: res.steps ?? [] };
  }

  async saveProductIntakeStep(input: {
    sessionId: number;
    expectedRevision: number;
    stepKey: string;
    complete: boolean;
    data?: Record<string, unknown>;
  }): Promise<ProductIntakeSession> {
    const res = await rpc<{ ok: boolean; session?: ProductIntakeSession }>("product:intake:step", {
      step: { ...input, commandId: globalThis.crypto.randomUUID() },
    });
    if (!res.session) throw new Error("Product intake step could not be saved.");
    return res.session;
  }

  async publishProductIntake(input: {
    sessionId: number;
    expectedRevision: number;
    commandType: "CHECK_READY" | "PUBLISH" | "ABANDON";
  }): Promise<ProductIntakeSession> {
    const res = await rpc<{ ok: boolean; session?: ProductIntakeSession }>("product:intake:publish", {
      command: { ...input, commandId: globalThis.crypto.randomUUID() },
    });
    if (!res.session) throw new Error("Product intake publish check could not be saved.");
    return res.session;
  }

  async vehicleForAuction(auctionId: number): Promise<VehicleBundle> {
    const res = await rpc<{ ok: boolean; bundle?: VehicleBundle }>("vehicle:get", { auctionId });
    return res.bundle ?? { vehicle: null, permissions: { inspect: false, review: false, administer: false } };
  }

  async saveVehicleIntake(auctionId: number, vehicle: VehicleIntakeInput): Promise<VehicleBundle> {
    await rpc("vehicle:intake", { auctionId, vehicle });
    return this.vehicleForAuction(auctionId);
  }

  async addVehicleHistoryEvent(vehicleId: number, history: {
    eventType: string; title: string; description?: string; occurredOn?: string | null;
    odometerKm?: number | null; providerName?: string | null; countryCode?: string | null;
  }): Promise<Record<string, unknown>> {
    const res = await rpc<{ ok: boolean; historyEvent?: Record<string, unknown> }>("vehicle:history:add", { vehicleId, history });
    if (!res.historyEvent) throw new Error("Vehicle history event could not be read back.");
    return res.historyEvent;
  }

  async addVehicleModification(vehicleId: number, modification: {
    category: string; title: string; description?: string; installedOn?: string | null;
    installer?: string | null; approvalReference?: string | null; reversible?: boolean | null;
  }): Promise<Record<string, unknown>> {
    const res = await rpc<{ ok: boolean; modification?: Record<string, unknown> }>("vehicle:modification:add", { vehicleId, modification });
    if (!res.modification) throw new Error("Vehicle modification could not be read back.");
    return res.modification;
  }

  async addVehicleEquipment(vehicleId: number, equipment: {
    equipmentType: string; equipmentKey?: string | null; label: string; description?: string;
    quantity?: number; included?: boolean; conditionState?: string | null;
  }): Promise<Record<string, unknown>> {
    const res = await rpc<{ ok: boolean; equipment?: Record<string, unknown> }>("vehicle:equipment:add", { vehicleId, equipment });
    if (!res.equipment) throw new Error("Vehicle equipment could not be read back.");
    return res.equipment;
  }

  async addVehicleDocument(
    vehicleId: number,
    document: {
      documentType: string; documentRef: string; issuer?: string | null;
      issuedAt?: string | null; expiresAt?: string | null; storageRef?: string | null;
      documentNumber?: string | null; artifactRequired?: boolean;
    },
  ): Promise<VehicleDocument> {
    const res = await rpc<{ ok: boolean; document?: VehicleDocument }>("vehicle:document:add", { vehicleId, document });
    if (!res.document) throw new Error("Vehicle document could not be read back.");
    return res.document;
  }

  async reviewVehicleDocument(documentId: number, action: "VERIFY" | "REJECT", reason?: string, derivedFact?: {
    attributeKey: string; value: unknown; extractionPath: string;
  } | null): Promise<VehicleDocument> {
    const res = await rpc<{ ok: boolean; document?: VehicleDocument }>(
      "vehicle:document:review", { documentId, action, reason: reason ?? null, derivedFact: derivedFact ?? null },
    );
    if (!res.document) throw new Error("Vehicle document review could not be read back.");
    return res.document;
  }

  async startVehicleInspection(vehicleId: number): Promise<VehicleInspection> {
    const res = await rpc<{ ok: boolean; inspection?: VehicleInspection }>("vehicle:inspection:start", { vehicleId });
    if (!res.inspection) throw new Error("Inspection could not be read back.");
    return res.inspection;
  }

  async addVehicleFinding(
    inspectionId: number,
    finding: {
      category: string; component: string; location?: string | null; severity: string;
      description: string; repairRecommended?: boolean; safetyCritical?: boolean;
      evidenceDocumentId?: number | null;
    },
  ): Promise<VehicleFinding> {
    const res = await rpc<{ ok: boolean; finding?: VehicleFinding }>(
      "vehicle:inspection:finding", { inspectionId, finding },
    );
    if (!res.finding) throw new Error("Finding could not be read back.");
    return res.finding;
  }

  async submitVehicleInspection(
    inspectionId: number,
    inspection: { roadworthy: boolean; odometerKm: number; notes?: string | null },
  ): Promise<VehicleInspection> {
    const res = await rpc<{ ok: boolean; inspection?: VehicleInspection }>(
      "vehicle:inspection:submit", { inspectionId, inspection },
    );
    if (!res.inspection) throw new Error("Inspection could not be read back.");
    return res.inspection;
  }

  async reviewVehicleInspection(inspectionId: number): Promise<VehicleBundle> {
    const res = await rpc<{ ok: boolean; bundle?: VehicleBundle }>(
      "vehicle:inspection:review",
      { inspectionId, commandId: globalThis.crypto.randomUUID() },
    );
    if (!res.bundle) throw new Error("Vehicle review could not be read back.");
    return res.bundle;
  }

  async mySelling(): Promise<Auction[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/auction_public", {
      headers: this.authHeaders(),
      params: {
        [`filter[user][$eq]`]: this.cachedUser!.id,
        order: "-created_at",
        limit: 100,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async myBids(): Promise<
    { auction: Auction; myMax: number; winning: boolean; active: Bid | undefined }[]
  > {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/bids", {
      headers: this.authHeaders(),
      params: { [`filter[user][$eq]`]: this.cachedUser!.id, order: "-id", limit: 200 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const bids: Bid[] = data.records ?? [];
    const byAuction = new Map<number, Bid[]>();
    for (const b of bids) {
      if (!byAuction.has(b.auction_id)) byAuction.set(b.auction_id, []);
      byAuction.get(b.auction_id)!.push(b);
    }
    const out: { auction: Auction; myMax: number; winning: boolean; active: Bid | undefined }[] = [];
    for (const [auctionId, list] of byAuction) {
      const auction = await this.auction(auctionId);
      if (!auction) continue;
      const active = list.find((b) => b.status === "active");
      out.push({
        auction,
        myMax: Math.max(...list.map((b) => b.max_amount)),
        winning: !!active,
        active,
      });
    }
    return out.sort((a, b) => a.auction.ends_at.localeCompare(b.auction.ends_at));
  }

  async myWon(): Promise<Auction[]> {
    const orders = await this.orders("buying");
    const ids = orders.map((o) => o.auction_id);
    const out: Auction[] = [];
    for (const id of ids) {
      const a = await this.auction(id);
      if (a) out.push(a);
    }
    return out;
  }

  // ── messaging (reads direct, writes via engine) ──────────────────
  async threads(): Promise<Thread[]> {
    if (!this.token()) return [];
    const res = await tbFetch("/api/records/v1/threads", {
      headers: this.authHeaders(),
      params: { order: "-last_message_at", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async threadMessages(threadId: number): Promise<Message[]> {
    const res = await tbFetch("/api/records/v1/messages", {
      headers: this.authHeaders(),
      params: { [`filter[thread_id][$eq]`]: threadId, order: "created_at", limit: 300 },
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return data.records ?? [];
  }

  // ── orders ──────────────────────────────────────────────────────
  async orders(role: "buying" | "selling"): Promise<Order[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/orders", {
      headers: this.authHeaders(),
      params: { order: "-created_at", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const me = this.cachedUser!.id;
    const all: Order[] = data.records ?? [];
    return all.filter((o) => (role === "buying" ? o.buyer_user === me : o.seller_user === me));
  }

  async order(id: number): Promise<Order | null> {
    const res = await tbFetch(`/api/records/v1/orders/${id}`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json();
  }

  async paymentsFor(orderId: number): Promise<Payment[]> {
    const res = await tbFetch("/api/records/v1/payments", {
      headers: this.authHeaders(),
      params: { [`filter[order_id][$eq]`]: orderId, order: "id", limit: 50 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async payOrder(orderId: number, method: string, reference?: string): Promise<Order> {
    const res = await rpc<{ ok: boolean; error?: string; order?: Order }>("order:pay", {
      orderId,
      method,
      reference,
    });
    if (!res.order) throw new Error("Payment could not be recorded.");
    return res.order;
  }

  async markShipped(orderId: number, carrier: string, tracking: string): Promise<Order> {
    const res = await rpc<{ ok: boolean; error?: string; order?: Order }>("order:ship", {
      orderId,
      carrier,
      tracking,
    });
    if (!res.order) throw new Error("Could not mark as shipped.");
    return res.order;
  }

  async confirmDelivery(orderId: number): Promise<Order> {
    const res = await rpc<{ ok: boolean; error?: string; order?: Order }>("order:deliver", {
      orderId,
    });
    if (!res.order) throw new Error("Could not confirm delivery.");
    return res.order;
  }

  async rateOrder(orderId: number, score: number, comment: string): Promise<Rating> {
    const res = await rpc<{ ok: boolean; error?: string; rating?: Rating }>("order:rate", {
      orderId,
      score,
      comment,
    });
    if (!res.rating) throw new Error("Could not submit rating.");
    return res.rating;
  }

  // ── notifications ───────────────────────────────────────────────
  async notifications(): Promise<Notification[]> {
    if (!this.token()) return [];
    const res = await tbFetch("/api/records/v1/notifications", {
      headers: this.authHeaders(),
      params: { order: "-created_at", limit: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async markNotificationsRead(): Promise<void> {
    if (!this.token()) return;
    const list = await this.notifications();
    const unread = list.filter((n) => !n.read);
    await Promise.all(
      unread.map((n) =>
        tbFetch(`/api/records/v1/notifications/${n.id}`, {
          method: "PATCH",
          headers: this.authHeaders(),
          body: JSON.stringify({ read: 1 }),
        }),
      ),
    );
  }

  async logAudit(
    action: string,
    entity: string,
    entityId?: number,
    payload?: string,
    source = "web",
  ) {
    try {
      await tbFetch("/api/records/v1/audit_events", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          user: this.cachedUser?.id ?? null,
          action,
          entity,
          entity_id: entityId ?? null,
          source,
          payload: payload ?? "",
          created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        }),
      });
    } catch {
      /* best effort */
    }
  }

  // ── Gap-8: saved searches (user-owned, TrailBase REST + DISC-03 facets) ───────────
  async savedSearches(): Promise<SavedSearch[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/saved_searches", {
      headers: this.authHeaders(),
      params: { order: "-created_at", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const searches = (data.records ?? []) as SavedSearch[];
    for (const s of searches) {
      s.facets = await this.savedSearchFacets(s.id).catch(() => []);
    }
    return searches;
  }

  async savedSearchFacets(savedSearchId: number): Promise<SavedSearchFacet[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    let transportError = false;
    try {
      const res = await rpc<{ ok: boolean; facets?: SavedSearchFacet[]; error?: string }>(
        "saved-search:facets:get",
        { savedSearchId },
      );
      if (res?.ok && Array.isArray(res.facets)) return res.facets;
      if (res && res.ok === false) {
        throw new Error(res.error || "Not authorized to load saved search facets.");
      }
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg && !/not connected|timeout|socket/i.test(msg)) {
        throw err;
      }
      transportError = true;
    }
    if (!transportError) return [];
    const res = await tbFetch("/api/records/v1/saved_search_facets", {
      headers: this.authHeaders(),
      params: { [`filter[saved_search_id][$eq]`]: savedSearchId, limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async saveSearch(input: SaveSearchInput): Promise<SavedSearch> {
    if (!this.cachedUser && !(await this.currentUser()))
      throw new Error("Sign in to save searches.");
    const normalizedInput: SaveSearchInput = {
      ...input,
      facets: Array.isArray(input.facets)
        ? input.facets.map((f) => ({
            attributeKey: f.attributeKey.toUpperCase() === "YEAR" ? "MODEL_YEAR" : f.attributeKey.toUpperCase(),
            operator: f.operator.toUpperCase(),
            valueText: f.valueText ?? f.optionValue ?? f.textValue ?? null,
            valueNumber: f.valueNumber ?? null,
            valueBoolean: f.valueBoolean ?? f.booleanValue ?? null,
            valueMin: f.valueMin ?? f.minNumeric ?? null,
            valueMax: f.valueMax ?? f.maxNumeric ?? null,
          }))
        : undefined,
    };
    try {
      const res = await rpc<{ ok: boolean; savedSearch?: SavedSearch; error?: string }>(
        "saved-search:save",
        { search: normalizedInput },
      );
      if (res?.ok && res.savedSearch) return res.savedSearch;
      if (res && res.ok === false) {
        throw new Error(res.error || "Could not save search.");
      }
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg && !/not connected|timeout|socket/i.test(msg)) {
        throw err;
      }
    }
    // high-water mark: only listings created AFTER this point trigger alerts
    const top = await tbFetch("/api/records/v1/auction_public", {
      headers: this.authHeaders(),
      params: { order: "-id", limit: 1 },
    });
    let lastSeen = 0;
    if (top.ok) lastSeen = Number(((await top.json())?.records ?? [])[0]?.id ?? 0);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const res = await tbFetch("/api/records/v1/saved_searches", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        user: this.cachedUser!.id,
        name: normalizedInput.name.slice(0, 80),
        query: normalizedInput.query?.trim() || null,
        category: normalizedInput.category || null,
        product_category_id: normalizedInput.productCategoryId ?? null,
        product_schema_version_id: normalizedInput.productSchemaVersionId ?? null,
        category_key: normalizedInput.categoryKey ?? null,
        min_price: normalizedInput.minPrice ?? null,
        max_price: normalizedInput.maxPrice ?? null,
        alerts: normalizedInput.alerts === false ? 0 : 1,
        last_seen_id: lastSeen,
        created_at: now,
        updated_at: now,
      }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    const createdId = Number(data.ids?.[0] ?? 0);
    if (Array.isArray(normalizedInput.facets)) {
      for (const f of normalizedInput.facets) {
        if (!f.attributeKey || !f.operator) continue;
        await tbFetch("/api/records/v1/saved_search_facets", {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({
            saved_search_id: createdId,
            attribute_key: f.attributeKey.toUpperCase(),
            operator: f.operator.toUpperCase(),
            value_text: f.valueText ?? null,
            value_number: f.valueNumber ?? null,
            value_boolean: f.valueBoolean != null ? (f.valueBoolean ? 1 : 0) : null,
            value_min: f.valueMin ?? null,
            value_max: f.valueMax ?? null,
            value_json: "{}",
            created_at: now,
          }),
        }).catch(() => null);
      }
    }
    const created = await tbFetch(
      `/api/records/v1/saved_searches/${createdId}`,
      { headers: this.authHeaders() },
    );
    if (!created.ok) throw new Error("Search saved but could not be read back.");
    const saved = await created.json();
    saved.facets = await this.savedSearchFacets(createdId);
    return saved;
  }

  async deleteSearch(id: number): Promise<void> {
    const res = await tbFetch(`/api/records/v1/saved_searches/${id}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
  }

  async setSearchAlerts(id: number, on: boolean): Promise<void> {
    const res = await tbFetch(`/api/records/v1/saved_searches/${id}`, {
      method: "PATCH",
      headers: this.authHeaders(),
      body: JSON.stringify({ alerts: on ? 1 : 0 }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
  }

  // ── Gap-8: Best-Offer / haggle (writes via engine RPC) ───────────
  async offersFor(auctionId: number): Promise<Offer[]> {
    const res = await tbFetch("/api/records/v1/offers", {
      params: { [`filter[auction_id][$eq]`]: auctionId, order: "-id", limit: 50 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async myOffers(): Promise<Offer[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/offers", {
      headers: this.authHeaders(),
      params: { [`filter[buyer_user][$eq]`]: this.cachedUser!.id, order: "-id", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async submitOffer(auctionId: number, amount: number, message?: string): Promise<Offer> {
    const res = await rpc<{ ok: boolean; error?: string; offer?: Offer }>("offer:submit", {
      auctionId,
      amount,
      message: message ?? null,
    });
    if (!res.offer) throw new Error(res.error || "Could not submit the offer.");
    return res.offer;
  }

  async withdrawOffer(offerId: number): Promise<Offer> {
    const res = await rpc<{ ok: boolean; error?: string; offer?: Offer }>("offer:withdraw", {
      offerId,
    });
    if (!res.offer) throw new Error(res.error || "Could not withdraw the offer.");
    return res.offer;
  }

  async respondOffer(
    offerId: number,
    action: "accept" | "decline" | "counter",
    amount?: number,
    message?: string,
  ): Promise<Offer> {
    const res = await rpc<{ ok: boolean; error?: string; offer?: Offer }>("offer:respond", {
      offerId,
      action,
      amount: amount ?? null,
      message: message ?? null,
    });
    if (!res.offer) throw new Error(res.error || "Could not respond to the offer.");
    return res.offer;
  }

  async acceptCounter(offerId: number, accept: boolean): Promise<Offer> {
    const res = await rpc<{ ok: boolean; error?: string; offer?: Offer }>(
      "offer:counter-respond",
      { offerId, accept },
    );
    if (!res.offer) throw new Error(res.error || "Could not answer the counter-offer.");
    return res.offer;
  }

  // ── Gap-8: bid retraction ─────────────────────────────────────────
  async retractBid(bidId: number, reason: string): Promise<{ auction: Auction | null }> {
    const res = await rpc<{ ok: boolean; error?: string; auction?: Auction }>("bid:retract", {
      bidId,
      reason,
      commandId: globalThis.crypto.randomUUID(),
    });
    if (!res.ok) throw new Error(res.error || "Could not retract the bid.");
    return { auction: res.auction ?? null };
  }

  // ── Gap-8: featured listing (US$2 + VAT fee, engine → finance) ────
  async featureListing(auctionId: number): Promise<Auction> {
    const res = await rpc<{ ok: boolean; error?: string; auction?: Auction }>(
      "listing:feature",
      { auctionId },
    );
    if (!res.auction) throw new Error(res.error || "Could not feature the listing.");
    return res.auction;
  }

  // ── Gap-8: live-room sessions ─────────────────────────────────────
  async liveSessions(): Promise<LiveSession[]> {
    const res = await tbFetch("/api/records/v1/live_sessions", {
      params: { order: "-scheduled_at", limit: 50 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async liveSession(id: number): Promise<LiveSession | null> {
    const res = await tbFetch(`/api/records/v1/live_sessions/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json();
  }

  async createLiveRoom(input: { title: string; scheduledAt?: string }): Promise<LiveSession> {
    const res = await rpc<{ ok: boolean; error?: string; session?: LiveSession }>(
      "room:create",
      { title: input.title, scheduledAt: input.scheduledAt ?? null },
    );
    if (!res.session) throw new Error(res.error || "Could not create the live room.");
    return res.session;
  }

  async addRoomLot(sessionId: number, auctionId: number): Promise<void> {
    const res = await rpc<{ ok: boolean; error?: string }>("room:add-lot", {
      sessionId,
      auctionId,
      commandId: globalThis.crypto.randomUUID(),
    });
    if (!res.ok) throw new Error(res.error || "Could not add the lot.");
  }

  async removeRoomLot(sessionId: number, auctionId: number): Promise<void> {
    const res = await rpc<{ ok: boolean; error?: string }>("room:remove-lot", {
      sessionId,
      auctionId,
      commandId: globalThis.crypto.randomUUID(),
    });
    if (!res.ok) throw new Error(res.error || "Could not remove the lot.");
  }

  async openRoomLot(sessionId: number, auctionId?: number): Promise<LiveSession> {
    const res = await rpc<{ ok: boolean; error?: string; session?: LiveSession }>(
      "host:open-lot",
      { sessionId, auctionId: auctionId ?? null, commandId: globalThis.crypto.randomUUID() },
    );
    if (!res.session) throw new Error(res.error || "Could not open the lot.");
    return res.session;
  }

  async closeRoomLot(sessionId: number, sold: boolean): Promise<LiveSession> {
    const res = await rpc<{ ok: boolean; error?: string; session?: LiveSession }>(
      "host:close-lot",
      { sessionId, sold, commandId: globalThis.crypto.randomUUID() },
    );
    if (!res.session) throw new Error(res.error || "Could not close the lot.");
    return res.session;
  }

  async endLiveRoom(sessionId: number): Promise<LiveSession> {
    const res = await rpc<{ ok: boolean; error?: string; session?: LiveSession }>(
      "host:end-session",
      { sessionId, commandId: globalThis.crypto.randomUUID() },
    );
    if (!res.session) throw new Error(res.error || "Could not end the room.");
    return res.session;
  }

  async roomLots(sessionId: number): Promise<Auction[]> {
    const session = await this.liveSession(sessionId);
    if (session?.event_id != null) {
      const bundle = await this.auctionEventBundle(Number(session.event_id));
      return (bundle.lots ?? [])
        .filter((lot) => lot.status !== "WITHDRAWN")
        .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
        .map((lot) => lot.auction)
        .filter((auction): auction is Auction => !!auction);
    }
    const res = await tbFetch("/api/records/v1/auction_public", {
      params: {
        [`filter[live_session_id][$eq]`]: sessionId,
        order: "id",
        limit: 100,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  // ── IMP-05: AuctionEvent / production run-list authority ──────────
  async auctionEvents(): Promise<AuctionEvent[]> {
    const res = await tbFetch("/api/records/v1/auction_events", {
      params: { order: "starts_at", limit: 200 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async auctionEventBundle(id: number): Promise<AuctionEventBundle> {
    const res = await rpc<{ ok: boolean; error?: string; bundle?: AuctionEventBundle }>(
      "event:bundle",
      { eventId: id },
    );
    if (!res.bundle) throw new Error(res.error || "Could not load the auction event.");
    return res.bundle;
  }

  async createAuctionEvent(input: {
    title: string;
    description?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    timezone?: string | null;
    venue?: {
      name: string;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      timezone?: string | null;
      venueType?: "PHYSICAL" | "HYBRID" | "ONLINE";
    } | null;
  }): Promise<AuctionEventBundle> {
    const res = await rpc<{ ok: boolean; error?: string; bundle?: AuctionEventBundle }>(
      "event:create",
      { event: input },
    );
    if (!res.bundle) throw new Error(res.error || "Could not create the auction event.");
    return res.bundle;
  }

  async grantEventOperator(
    eventId: number,
    username: string,
    role: "AUCTIONEER" | "CLERK",
  ): Promise<AuctionEventBundle> {
    const res = await rpc<{ ok: boolean; error?: string; bundle?: AuctionEventBundle }>(
      "event:operator:grant",
      { eventId, username, role },
    );
    if (!res.bundle) throw new Error(res.error || "Could not assign the event operator.");
    return res.bundle;
  }

  async runListCommand(input: RunListCommandInput): Promise<AuctionEventBundle> {
    const res = await rpc<{ ok: boolean; error?: string; bundle?: AuctionEventBundle }>(
      "run-list:command",
      {
        ...input,
        commandId: input.commandId ?? globalThis.crypto.randomUUID(),
      },
    );
    if (!res.bundle) throw new Error(res.error || "Run-list command failed.");
    return res.bundle;
  }
}
