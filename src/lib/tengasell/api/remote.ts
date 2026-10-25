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
    const params: Record<string, string | number> = {
      ...filterParams(q),
      order: orderParam(q),
      limit: q.limit ?? 24,
      offset: q.offset ?? 0,
      count: "true",
    };
    const res = await tbFetch("/api/records/v1/auctions", { params });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    return { items: data.records ?? [], total: data.total_count ?? data.records?.length ?? 0 };
  }

  async auction(id: number): Promise<Auction | null> {
    const res = await tbFetch(`/api/records/v1/auctions/${id}`);
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
    const res = await tbFetch("/api/records/v1/auctions", {
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
  async vehicleForAuction(auctionId: number): Promise<VehicleBundle> {
    const res = await rpc<{ ok: boolean; bundle?: VehicleBundle }>("vehicle:get", { auctionId });
    return res.bundle ?? { vehicle: null, permissions: { inspect: false, review: false, administer: false } };
  }

  async saveVehicleIntake(auctionId: number, vehicle: VehicleIntakeInput): Promise<VehicleBundle> {
    await rpc("vehicle:intake", { auctionId, vehicle });
    return this.vehicleForAuction(auctionId);
  }

  async addVehicleDocument(
    vehicleId: number,
    document: {
      documentType: string; documentRef: string; issuer?: string | null;
      issuedAt?: string | null; expiresAt?: string | null; storageRef?: string | null;
    },
  ): Promise<VehicleDocument> {
    const res = await rpc<{ ok: boolean; document?: VehicleDocument }>("vehicle:document:add", { vehicleId, document });
    if (!res.document) throw new Error("Vehicle document could not be read back.");
    return res.document;
  }

  async reviewVehicleDocument(documentId: number, action: "VERIFY" | "REJECT", reason?: string): Promise<VehicleDocument> {
    const res = await rpc<{ ok: boolean; document?: VehicleDocument }>(
      "vehicle:document:review", { documentId, action, reason: reason ?? null },
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
    const res = await tbFetch("/api/records/v1/auctions", {
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

  // ── Gap-8: saved searches (user-owned, TrailBase REST) ───────────
  async savedSearches(): Promise<SavedSearch[]> {
    if (!this.cachedUser && !(await this.currentUser())) return [];
    const res = await tbFetch("/api/records/v1/saved_searches", {
      headers: this.authHeaders(),
      params: { order: "-created_at", limit: 100 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.records ?? [];
  }

  async saveSearch(input: SaveSearchInput): Promise<SavedSearch> {
    if (!this.cachedUser && !(await this.currentUser()))
      throw new Error("Sign in to save searches.");
    // high-water mark: only listings created AFTER this point trigger alerts
    const top = await tbFetch("/api/records/v1/auctions", {
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
        name: input.name.slice(0, 80),
        query: input.query?.trim() || null,
        category: input.category || null,
        min_price: input.minPrice ?? null,
        max_price: input.maxPrice ?? null,
        alerts: input.alerts === false ? 0 : 1,
        last_seen_id: lastSeen,
        created_at: now,
        updated_at: now,
      }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = await res.json();
    const created = await tbFetch(
      `/api/records/v1/saved_searches/${data.ids?.[0] ?? 0}`,
      { headers: this.authHeaders() },
    );
    if (!created.ok) throw new Error("Search saved but could not be read back.");
    return await created.json();
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
    const res = await tbFetch("/api/records/v1/auctions", {
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
