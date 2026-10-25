"use client";

// Tengasell local demo store — full offline fallback implementing the same
// contract as the TrailBase remote adapter. Used when the Rust backend is
// unreachable so the marketplace experience stays intact (NXS offline state).

import { buildSeed, DEMO_PASSWORD, SEED_PROFILES } from "@/data/seed";
import { bidIncrement, round2, slugify } from "@/lib/tengasell/format";
import { bus } from "../bus";
import type {
  Auction,
  AuctionQuery,
  Bid,
  BidResult,
  Category,
  CurrentUser,
  Message,
  Notification,
  Order,
  Paginated,
  Payment,
  Profile,
  Question,
  Rating,
  Thread,
} from "../types";

interface LocalUser {
  id: string;
  username: string;
  password: string;
  admin: boolean;
  registered: boolean;
}

const AUTH_KEY = "ts_local_auth";
const REG_KEY = "ts_local_users";

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export class LocalStore {
  private seed = buildSeed();
  // ── Gap-8 demo stores (in-memory) ────
  private savedSearchRows: import("../types").SavedSearch[] = [];
  private offers: import("../types").Offer[] = [];
  private rooms: import("../types").LiveSession[] = [
    {
      id: 1,
      host_user: "demo-host",
      host_username: "tatenda",
      title: "Demo: Friday Night Live Room",
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      status: "scheduled",
      current_lot_id: null,
      lot_index: 0,
      close_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  private nextSearchId = 100;
  private nextOfferId = 100;
  private nextRoomId = 2;
  private users: LocalUser[] = [];
  private nextAuctionId = 3000;
  private nextBidId = 5000;
  private nextQuestionId = 100;
  private nextThreadId = 100;
  private nextMessageId = 500;
  private nextOrderId = 100;
  private nextPaymentId = 100;
  private nextRatingId = 100;
  private nextNotificationId = 100;
  private nextWatchId = 100;
  private auth: { username: string } | null = null;

  constructor() {
    // seeded personas + admin
    this.users = SEED_PROFILES.map((p) => ({
      id: `seed-user-${p.username}`,
      username: p.username,
      password: DEMO_PASSWORD,
      admin: p.username === "admin",
      registered: false,
    }));
    // registered (persisted) users
    try {
      const reg = JSON.parse(localStorage.getItem(REG_KEY) || "[]");
      for (const u of reg) this.users.push(u);
      this.nextAuctionId += reg.length;
    } catch {
      /* ignore */
    }
    try {
      const a = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      if (a?.username && this.users.some((u) => u.username === a.username)) {
        this.auth = a;
      }
    } catch {
      /* ignore */
    }
  }

  private me(): LocalUser | null {
    if (!this.auth) return null;
    return this.users.find((u) => u.username === this.auth!.username) ?? null;
  }

  private persistUsers() {
    try {
      localStorage.setItem(
        REG_KEY,
        JSON.stringify(this.users.filter((u) => u.registered)),
      );
    } catch {
      /* ignore */
    }
  }

  private touch() {
    /* marks in-memory mutation (no-op; store is memory-first) */
  }

  // ── auth ────────────────────────────────────────────────────────
  register(username: string, password: string): { ok: boolean; error?: string } {
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9]{3,24}$/.test(uname))
      return { ok: false, error: "Username must be 3–24 letters/numbers." };
    if (this.users.some((u) => u.username === uname))
      return { ok: false, error: "That username is already taken." };
    if (password.length < 8)
      return { ok: false, error: "Password must be at least 8 characters." };
    const user: LocalUser = {
      id: `local-user-${uname}`,
      username: uname,
      password,
      admin: false,
      registered: true,
    };
    this.users.push(user);
    this.seed.profiles.push({
      id: this.seed.profiles.length + 1,
      user: user.id,
      username: uname,
      display_name: uname,
      bio: "New to Tengasell.",
      city: "",
      rating_avg: 0,
      rating_count: 0,
      sales: 0,
      response_minutes: 120,
      verified: 0,
      joined_at: nowIso(),
    });
    this.persistUsers();
    this.seed.notifications.push({
      id: this.nextNotificationId++,
      user: user.id,
      type: "info",
      title: "Welcome to Tengasell",
      body: "a snap to your happy deal — your account is ready.",
      link: "#/",
      read: 0,
      created_at: nowIso(),
    });
    return { ok: true };
  }

  login(username: string, password: string): { ok: boolean; error?: string; user?: CurrentUser } {
    const u = this.users.find((x) => x.username === username.trim().toLowerCase());
    if (!u) return { ok: false, error: "No account found with that username." };
    if (u.password !== password) return { ok: false, error: "Incorrect password." };
    this.auth = { username: u.username };
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(this.auth));
    } catch {
      /* ignore */
    }
    return { ok: true, user: this.currentUserSync()! };
  }

  logout() {
    this.auth = null;
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Demo mode never runs the gated sign-in — no-op for interface parity. */
  adoptExternalSession() {
    /* no-op */
  }

  clearExternalSession() {
    this.logout();
  }

  currentUserSync(): CurrentUser | null {
    const me = this.me();
    if (!me) return null;
    return {
      id: me.id,
      username: me.username,
      token: "local-demo-token",
      admin: me.admin,
      profile: this.seed.profiles.find((p) => p.user === me.id) ?? null,
    };
  }

  async currentUser(): Promise<CurrentUser | null> {
    return this.currentUserSync();
  }

  // ── catalog ─────────────────────────────────────────────────────
  async categories(): Promise<Category[]> {
    return this.seed.categories;
  }

  async auctions(q: AuctionQuery = {}): Promise<Paginated<Auction>> {
    let list = [...this.seed.auctions];
    const status = q.status ?? "live";
    if (status !== "all") list = list.filter((a) => a.status === status);
    if (q.category) list = list.filter((a) => a.category === q.category);
    if (q.seller) list = list.filter((a) => a.seller_username === q.seller);
    if (q.search) {
      const term = q.search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(term) ||
          a.description.toLowerCase().includes(term),
      );
    }
    if (q.minPrice != null) list = list.filter((a) => a.current_price >= q.minPrice!);
    if (q.maxPrice != null) list = list.filter((a) => a.current_price <= q.maxPrice!);
    if (q.condition) list = list.filter((a) => a.condition === q.condition);
    if (q.city) list = list.filter((a) => a.city === q.city);
    if (q.featured) list = list.filter((a) => a.featured === 1);
    if (q.endingWithinMinutes != null) {
      const until = Date.now() + q.endingWithinMinutes * 60_000;
      list = list.filter((a) => {
        const ends = Date.parse(a.ends_at);
        return ends >= Date.now() && ends <= until;
      });
    }
    switch (q.order ?? "ending") {
      case "newest":
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "price_asc":
        list.sort((a, b) => a.current_price - b.current_price);
        break;
      case "price_desc":
        list.sort((a, b) => b.current_price - a.current_price);
        break;
      case "bids":
        list.sort((a, b) => b.bid_count - a.bid_count);
        break;
      case "hot":
        list.sort((a, b) => b.views - a.views);
        break;
      default:
        list.sort((a, b) => a.ends_at.localeCompare(b.ends_at));
    }
    const total = list.length;
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 24;
    return { items: list.slice(offset, offset + limit), total };
  }

  async auction(id: number): Promise<Auction | null> {
    return this.seed.auctions.find((a) => a.id === id) ?? null;
  }

  async bids(auctionId: number): Promise<Bid[]> {
    return this.seed.bids
      .filter((b) => b.auction_id === auctionId)
      .sort((a, b) => b.id - a.id);
  }

  async questions(auctionId: number): Promise<Question[]> {
    return this.seed.questions
      .filter((q) => q.auction_id === auctionId)
      .sort((a, b) => a.id - b.id);
  }

  async suggest(term: string): Promise<{ id: number; title: string; current_price: number }[]> {
    const t = term.toLowerCase();
    if (!t) return [];
    return this.seed.auctions
      .filter((a) => a.status === "live" && a.title.toLowerCase().includes(t))
      .slice(0, 6)
      .map((a) => ({ id: a.id, title: a.title, current_price: a.current_price }));
  }

  async profile(username: string): Promise<Profile | null> {
    return this.seed.profiles.find((p) => p.username === username) ?? null;
  }

  async ratingsFor(username: string): Promise<Rating[]> {
    return this.seed.ratings
      .filter((r) => r.ratee_username === username)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ── watchlist ───────────────────────────────────────────────────
  async watchState(auctionId: number): Promise<boolean> {
    const me = this.me();
    if (!me) return false;
    return this.seed.watchlist.some(
      (w) => w.user === me.id && w.auction_id === auctionId,
    );
  }

  async watch(auctionId: number, on: boolean): Promise<void> {
    const me = this.me();
    if (!me) throw new Error("Sign in to watch auctions.");
    const existing = this.seed.watchlist.find(
      (w) => w.user === me.id && w.auction_id === auctionId,
    );
    if (on && !existing) {
      this.seed.watchlist.push({
        id: this.nextWatchId++,
        user: me.id,
        auction_id: auctionId,
        created_at: nowIso(),
      });
      const a = this.seed.auctions.find((x) => x.id === auctionId);
      if (a) {
        a.watch_count += 1;
        bus.emit("auction:update", { auction: a });
      }
    } else if (!on && existing) {
      this.seed.watchlist = this.seed.watchlist.filter((w) => w !== existing);
      const a = this.seed.auctions.find((x) => x.id === auctionId);
      if (a) {
        a.watch_count = Math.max(0, a.watch_count - 1);
        bus.emit("auction:update", { auction: a });
      }
    }
    this.touch();
  }

  async watchlist(): Promise<Auction[]> {
    const me = this.me();
    if (!me) return [];
    const ids = this.seed.watchlist
      .filter((w) => w.user === me.id)
      .map((w) => w.auction_id);
    return this.seed.auctions.filter((a) => ids.includes(a.id));
  }

  // ── bidding (Yahoo-style proxy + soft-close anti-snipe) ─────────
  async placeBid(auctionId: number, maxAmount: number): Promise<BidResult> {
    const me = this.me();
    if (!me) return { ok: false, error: "Sign in to place bids." };
    const auction = this.seed.auctions.find((a) => a.id === auctionId);
    if (!auction) return { ok: false, error: "Auction not found." };
    if (auction.status !== "live")
      return { ok: false, error: "This auction is no longer live." };
    if (Date.parse(auction.ends_at) <= Date.now())
      return { ok: false, error: "This auction has ended." };
    if (auction.user === me.id)
      return { ok: false, error: "You cannot bid on your own auction." };
    const active = this.seed.bids.find(
      (b) => b.auction_id === auctionId && b.status === "active",
    );
    const inc = bidIncrement(active ? active.amount : auction.start_price);

    if (active) {
      const min = round2(active.amount + inc);
      if (maxAmount < min)
        return { ok: false, error: `Your maximum bid is below the minimum next bid of US$${min}.` };
      if (maxAmount > active.max_amount) {
        // challenger wins
        active.status = "superseded";
        const price = round2(Math.min(maxAmount, active.max_amount + inc));
        const bid: Bid = {
          id: this.nextBidId++,
          auction_id: auctionId,
          user: me.id,
          bidder_username: me.username,
          amount: price,
          max_amount: maxAmount,
          is_auto: 1,
          status: "active",
          created_at: nowIso(),
        };
        this.seed.bids.push(bid);
        auction.current_price = price;
        auction.bid_count += 1;
        this.notifyUser(active.user, "outbid", "You were outbid", `${me.username} placed a higher bid on ${auction.title}.`, `#/item/${auctionId}`);
      } else {
        // auto re-raise by the standing bidder
        const newPrice = round2(Math.min(active.max_amount, maxAmount + inc));
        const reRaise: Bid = {
          id: this.nextBidId++,
          auction_id: auctionId,
          user: active.user,
          bidder_username: active.bidder_username,
          amount: newPrice,
          max_amount: active.max_amount,
          is_auto: 1,
          status: "active",
          created_at: nowIso(),
        };
        active.status = "superseded";
        this.seed.bids.push(reRaise);
        auction.current_price = newPrice;
        auction.bid_count += 1;
        this.notifyUser(me.id, "outbid", "You were outbid", `Automatic bidding for ${active.bidder_username} exceeded your maximum on ${auction.title}.`, `#/item/${auctionId}`);
        bus.emit("auction:update", { auction });
        return { ok: true, auction, outbid: true };
      }
    } else {
      if (maxAmount < auction.start_price)
        return { ok: false, error: `The opening bid is US$${auction.start_price}.` };
      const bid: Bid = {
        id: this.nextBidId++,
        auction_id: auctionId,
        user: me.id,
        bidder_username: me.username,
        amount: auction.start_price,
        max_amount: maxAmount,
        is_auto: 1,
        status: "active",
        created_at: nowIso(),
      };
      this.seed.bids.push(bid);
      auction.current_price = auction.start_price;
      auction.bid_count = 1;
    }

    // anti-snipe soft close: extend 5 minutes, up to 15 times (Yahoo rule)
    const remaining = Date.parse(auction.ends_at) - Date.now();
    if (remaining < 5 * 60_000 && auction.extension_count < 15) {
      auction.ends_at = new Date(Date.parse(auction.ends_at) + 5 * 60_000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z");
      auction.extension_count += 1;
    }

    bus.emit("auction:update", { auction });
    this.touch();
    return { ok: true, auction };
  }

  async buyNow(auctionId: number, _address?: string | null): Promise<{ orderId: number }> {
    const me = this.me();
    if (!me) throw new Error("Sign in to buy instantly.");
    const auction = this.seed.auctions.find((a) => a.id === auctionId);
    if (!auction) throw new Error("Auction not found.");
    if (auction.status !== "live") throw new Error("This auction is no longer live.");
    if (!auction.buy_now_price) throw new Error("This auction has no buy-now price.");
    if (auction.bid_count > 0)
      throw new Error("Buy-now is no longer available after the first bid.");
    if (auction.user === me.id) throw new Error("You cannot buy your own auction.");
    auction.status = "sold";
    const order: Order = {
      id: this.nextOrderId++,
      auction_id: auction.id,
      auction_title: auction.title,
      buyer_user: me.id,
      seller_user: auction.user,
      buyer_username: me.username,
      seller_username: auction.seller_username,
      final_price: auction.buy_now_price,
      status: "pending_payment",
      pay_by: new Date(Date.now() + 48 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"),
      paid_at: null,
      shipped_at: null,
      delivered_at: null,
      completed_at: null,
      carrier: null,
      tracking: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.seed.orders.push(order);
    this.notifyUser(auction.user, "sold", "Your item sold (buy-now)", `${me.username} bought ${auction.title} for US$${auction.buy_now_price}.`, `#/orders/${order.id}`);
    bus.emit("auction:update", { auction });
    bus.emit("order:update", { order });
    return { orderId: order.id };
  }

  // ── Q&A ─────────────────────────────────────────────────────────
  async askQuestion(auctionId: number, body: string): Promise<Question> {
    const me = this.me();
    if (!me) throw new Error("Sign in to ask questions.");
    const auction = this.seed.auctions.find((a) => a.id === auctionId);
    if (!auction) throw new Error("Auction not found.");
    const q: Question = {
      id: this.nextQuestionId++,
      auction_id: auctionId,
      user: me.id,
      asker_username: me.username,
      body,
      answer: null,
      answered_at: null,
      created_at: nowIso(),
    };
    this.seed.questions.push(q);
    this.notifyUser(auction.user, "question", "Question on your item", `${me.username}: ${body.slice(0, 80)}`, `#/item/${auctionId}`);
    bus.emit("question:update", { question: q });
    return q;
  }

  async answerQuestion(questionId: number, body: string): Promise<Question> {
    const me = this.me();
    if (!me) throw new Error("Sign in to answer questions.");
    const q = this.seed.questions.find((x) => x.id === questionId);
    if (!q) throw new Error("Question not found.");
    const auction = this.seed.auctions.find((a) => a.id === q.auction_id);
    if (!auction || auction.user !== me.id)
      throw new Error("Only the seller can answer this question.");
    q.answer = body;
    q.answered_at = nowIso();
    this.notifyUser(q.user, "question", "Your question was answered", `${auction.title}: ${body.slice(0, 80)}`, `#/item/${q.auction_id}`);
    bus.emit("question:update", { question: q });
    return q;
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
    allowOffers?: boolean;
    offerMin?: number | null;
  }): Promise<Auction> {
    const me = this.me();
    if (!me) throw new Error("Sign in to sell on Tengasell.");
    const now = Date.now();
    const auction: Auction = {
      id: this.nextAuctionId++,
      user: me.id,
      seller_username: me.username,
      title: input.title.trim(),
      slug: slugify(input.title),
      description: input.description.trim(),
      category: input.category,
      condition: input.condition,
      start_price: round2(input.start_price),
      current_price: round2(input.start_price),
      buy_now_price: input.buy_now_price ? round2(input.buy_now_price) : null,
      reserve_price: input.reserve_price ? round2(input.reserve_price) : null,
      bid_count: 0,
      watch_count: 0,
      views: 0,
      shipping_fee: input.shipping_fee ?? 0,
      shipping: input.shipping,
      city: input.city || "",
      ends_at: new Date(now + input.durationHours * 3600_000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z"),
      started_at: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"),
      status: "live",
      extension_count: 0,
      featured: input.featured ?? 0,
      allow_offers: input.allowOffers ? 1 : 0,
      offer_min: input.offerMin ?? null,
      live_session_id: null,
      images: JSON.stringify(input.images.slice(0, 4)),
      created_at: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"),
      updated_at: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"),
    };
    this.seed.auctions.unshift(auction);
    bus.emit("auction:update", { auction });
    return auction;
  }

  async mySelling(): Promise<Auction[]> {
    const me = this.me();
    if (!me) return [];
    return this.seed.auctions
      .filter((a) => a.user === me.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async myBids(): Promise<{ auction: Auction; myMax: number; winning: boolean; active: Bid | undefined }[]> {
    const me = this.me();
    if (!me) return [];
    const myBids = this.seed.bids.filter((b) => b.user === me.id);
    const byAuction = new Map<number, Bid[]>();
    for (const b of myBids) {
      if (!byAuction.has(b.auction_id)) byAuction.set(b.auction_id, []);
      byAuction.get(b.auction_id)!.push(b);
    }
    const out: { auction: Auction; myMax: number; winning: boolean; active: Bid | undefined }[] = [];
    for (const [auctionId, bids] of byAuction) {
      const auction = this.seed.auctions.find((a) => a.id === auctionId);
      if (!auction) continue;
      const active = bids.find((b) => b.status === "active");
      out.push({
        auction,
        myMax: Math.max(...bids.map((b) => b.max_amount)),
        winning: !!active,
        active,
      });
    }
    return out.sort((a, b) => a.auction.ends_at.localeCompare(b.auction.ends_at));
  }

  async myWon(): Promise<Auction[]> {
    const me = this.me();
    if (!me) return [];
    const wonIds = this.seed.orders.filter((o) => o.buyer_user === me.id).map((o) => o.auction_id);
    return this.seed.auctions.filter((a) => wonIds.includes(a.id));
  }

  // ── messaging ───────────────────────────────────────────────────
  async threads(): Promise<Thread[]> {
    const me = this.me();
    if (!me) return [];
    return this.seed.threads
      .filter((t) => t.buyer_user === me.id || t.seller_user === me.id)
      .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  }

  async threadMessages(threadId: number): Promise<Message[]> {
    return this.seed.messages
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async sendMessage(input: {
    threadId?: number;
    auctionId?: number;
    toUsername?: string;
    body: string;
  }): Promise<{ message: Message; thread: Thread }> {
    const me = this.me();
    if (!me) throw new Error("Sign in to send messages.");
    let thread = input.threadId
      ? this.seed.threads.find((t) => t.id === input.threadId)
      : undefined;
    if (!thread && input.auctionId) {
      const auction = this.seed.auctions.find((a) => a.id === input.auctionId);
      if (!auction) throw new Error("Auction not found.");
      if (auction.user === me.id) throw new Error("This is your own listing.");
      thread = this.seed.threads.find(
        (t) => t.auction_id === input.auctionId && t.buyer_user === me.id,
      );
      if (!thread) {
        thread = {
          id: this.nextThreadId++,
          auction_id: input.auctionId,
          buyer_user: me.id,
          seller_user: auction.user,
          buyer_username: me.username,
          seller_username: auction.seller_username,
          subject: auction.title,
          last_message_at: null,
          created_at: nowIso(),
        };
        this.seed.threads.push(thread);
      }
    }
    if (!thread && input.toUsername) {
      const to = this.users.find((u) => u.username === input.toUsername);
      if (!to) throw new Error("Recipient not found.");
      thread = this.seed.threads.find(
        (t) =>
          !t.auction_id &&
          ((t.buyer_user === me.id && t.seller_user === to.id) ||
            (t.seller_user === me.id && t.buyer_user === to.id)),
      );
      if (!thread) {
        thread = {
          id: this.nextThreadId++,
          auction_id: null,
          buyer_user: me.id,
          seller_user: to.id,
          buyer_username: me.username,
          seller_username: to.username,
          subject: "Direct message",
          last_message_at: null,
          created_at: nowIso(),
        };
        this.seed.threads.push(thread);
      }
    }
    if (!thread) throw new Error("Conversation not found.");
    const message: Message = {
      id: this.nextMessageId++,
      thread_id: thread.id,
      user: me.id,
      sender_username: me.username,
      body: input.body.trim(),
      created_at: nowIso(),
    };
    this.seed.messages.push(message);
    thread.last_message_at = message.created_at;
    const recipient = thread.buyer_user === me.id ? thread.seller_user : thread.buyer_user;
    this.notifyUser(recipient, "message", `New message from ${me.username}`, input.body.slice(0, 80), `#/messages/${thread.id}`);
    bus.emit("message:new", { message });
    return { message, thread };
  }

  // ── orders / payments / ratings ─────────────────────────────────
  async orders(role: "buying" | "selling"): Promise<Order[]> {
    const me = this.me();
    if (!me) return [];
    return this.seed.orders
      .filter((o) => (role === "buying" ? o.buyer_user === me.id : o.seller_user === me.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async order(id: number): Promise<Order | null> {
    return this.seed.orders.find((o) => o.id === id) ?? null;
  }

  async paymentsFor(orderId: number): Promise<Payment[]> {
    return this.seed.payments.filter((p) => p.order_id === orderId);
  }

  async payOrder(orderId: number, method: string, reference?: string): Promise<Order> {
    const me = this.me();
    if (!me) throw new Error("Sign in to pay.");
    const order = this.seed.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    if (order.buyer_user !== me.id) throw new Error("Only the buyer can pay this order.");
    if (order.status !== "pending_payment")
      throw new Error("This order is not awaiting payment.");
    order.status = "paid";
    order.paid_at = nowIso();
    order.updated_at = nowIso();
    this.seed.payments.push({
      id: this.nextPaymentId++,
      order_id: orderId,
      user: me.id,
      method,
      amount: order.final_price,
      status: "settled",
      reference: reference || `${method.toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      created_at: nowIso(),
    });
    this.notifyUser(order.seller_user, "order", "Payment received", `${order.auction_title} — US$${order.final_price}. Dispatch within 3 days (SLA).`, `#/orders/${order.id}`);
    bus.emit("order:update", { order });
    return order;
  }

  async markShipped(orderId: number, carrier: string, tracking: string): Promise<Order> {
    const me = this.me();
    if (!me) throw new Error("Sign in first.");
    const order = this.seed.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    if (order.seller_user !== me.id) throw new Error("Only the seller can dispatch this order.");
    if (order.status !== "paid") throw new Error("Order must be paid before dispatch.");
    order.status = "shipped";
    order.shipped_at = nowIso();
    order.carrier = carrier;
    order.tracking = tracking;
    order.updated_at = nowIso();
    this.notifyUser(order.buyer_user, "order", "Your item has shipped", `${order.auction_title} via ${carrier} — tracking ${tracking}.`, `#/orders/${order.id}`);
    bus.emit("order:update", { order });
    return order;
  }

  async confirmDelivery(orderId: number): Promise<Order> {
    const me = this.me();
    if (!me) throw new Error("Sign in first.");
    const order = this.seed.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    if (order.buyer_user !== me.id) throw new Error("Only the buyer can confirm delivery.");
    if (order.status !== "shipped") throw new Error("Order must be shipped first.");
    order.status = "delivered";
    order.delivered_at = nowIso();
    order.updated_at = nowIso();
    this.notifyUser(order.seller_user, "order", "Delivery confirmed", `${order.auction_title} — buyer confirmed receipt. Rating window is open.`, `#/orders/${order.id}`);
    bus.emit("order:update", { order });
    return order;
  }

  async rateOrder(orderId: number, score: number, comment: string): Promise<Rating> {
    const me = this.me();
    if (!me) throw new Error("Sign in to rate.");
    const order = this.seed.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    const iAmBuyer = order.buyer_user === me.id;
    const ratee = iAmBuyer ? order.seller_user : order.buyer_user;
    const rateeUsername = iAmBuyer ? order.seller_username : order.buyer_username;
    if (!iAmBuyer && order.seller_user !== me.id) throw new Error("Not your order.");
    if (order.status !== "delivered" && order.status !== "completed")
      throw new Error("You can rate after delivery.");
    const rating: Rating = {
      id: this.nextRatingId++,
      order_id: orderId,
      user: me.id,
      ratee_user: ratee,
      ratee_username: rateeUsername,
      direction: iAmBuyer ? "as_buyer" : "as_seller",
      score,
      comment,
      created_at: nowIso(),
    };
    this.seed.ratings.push(rating);
    const profile = this.seed.profiles.find((p) => p.user === ratee);
    if (profile) {
      const total = profile.rating_avg * profile.rating_count + score;
      profile.rating_count += 1;
      profile.rating_avg = round2(total / profile.rating_count);
    }
    if (order.status === "delivered") {
      order.status = "completed";
      order.completed_at = nowIso();
      order.updated_at = nowIso();
      bus.emit("order:update", { order });
    }
    this.notifyUser(ratee, "rating", "You received a rating", `${me.username} rated you ${score}/5.`, `#/u/${rateeUsername}`);
    return rating;
  }

  // ── notifications ───────────────────────────────────────────────
  async notifications(): Promise<Notification[]> {
    const me = this.me();
    if (!me) return [];
    return this.seed.notifications
      .filter((n) => n.user === me.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async markNotificationsRead(): Promise<void> {
    const me = this.me();
    if (!me) return;
    for (const n of this.seed.notifications) if (n.user === me.id) n.read = 1;
  }

  private notifyUser(
    user: string,
    type: string,
    title: string,
    body: string,
    link: string,
  ) {
    const n: Notification = {
      id: this.nextNotificationId++,
      user,
      type,
      title,
      body,
      link,
      read: 0,
      created_at: nowIso(),
    };
    this.seed.notifications.push(n);
    bus.emit("notification:new", { notification: n });
  }

  async logAudit(action: string, entity: string, entityId?: number, payload?: string, source = "web") {
    /* demo: no-op */
    void action;
    void entity;
    void entityId;
    void payload;
    void source;
  }

  // ── Gap-8: demo implementations (in-memory, best-effort) ──────
  private findAuction(id: number): Auction | undefined {
    return this.seed.auctions.find((a) => a.id === id);
  }

  async savedSearches(): Promise<import("../types").SavedSearch[]> {
    const me = this.me();
    if (!me) return [];
    return this.savedSearchRows.filter((s) => s.user === me.id);
  }

  async saveSearch(input: import("../types").SaveSearchInput): Promise<import("../types").SavedSearch> {
    const me = this.me();
    if (!me) throw new Error("Sign in to save searches.");
    const now = new Date().toISOString();
    const maxId = Math.max(0, ...this.seed.auctions.map((a) => a.id));
    const row: import("../types").SavedSearch = {
      id: this.nextSearchId++,
      user: me.id,
      name: input.name.slice(0, 80),
      query: input.query?.trim() || null,
      category: input.category || null,
      min_price: input.minPrice ?? null,
      max_price: input.maxPrice ?? null,
      alerts: input.alerts === false ? 0 : 1,
      last_seen_id: maxId,
      created_at: now,
      updated_at: now,
    };
    this.savedSearchRows.unshift(row);
    return row;
  }

  async deleteSearch(id: number): Promise<void> {
    this.savedSearchRows = this.savedSearchRows.filter((s) => s.id !== id);
  }

  async setSearchAlerts(id: number, on: boolean): Promise<void> {
    const row = this.savedSearchRows.find((s) => s.id === id);
    if (row) row.alerts = on ? 1 : 0;
  }

  async offersFor(auctionId: number): Promise<import("../types").Offer[]> {
    return this.offers.filter((o) => o.auction_id === auctionId);
  }

  async myOffers(): Promise<import("../types").Offer[]> {
    const me = this.me();
    if (!me) return [];
    return this.offers.filter((o) => o.buyer_user === me.id);
  }

  async submitOffer(auctionId: number, amount: number, message?: string): Promise<import("../types").Offer> {
    const me = this.me();
    const auction = this.findAuction(auctionId);
    if (!me) throw new Error("Sign in to make an offer.");
    if (!auction) throw new Error("Item not found.");
    if (auction.allow_offers !== 1) throw new Error("This seller is not accepting offers.");
    if (auction.user === me.id) throw new Error("You cannot offer on your own item.");
    if (this.offers.some((o) => o.auction_id === auctionId && o.buyer_user === me.id && (o.status === "pending" || o.status === "countered")))
      throw new Error("You already have a pending offer on this item.");
    const now = new Date().toISOString();
    const offer: import("../types").Offer = {
      id: this.nextOfferId++,
      auction_id: auctionId,
      buyer_user: me.id,
      buyer_username: me.username,
      amount: round2(amount),
      message: message?.slice(0, 300) || null,
      status: "pending",
      counter_amount: null,
      counter_message: null,
      responded_at: null,
      created_at: now,
      updated_at: now,
    };
    this.offers.unshift(offer);
    return offer;
  }

  private patchOffer(id: number, patch: Partial<import("../types").Offer>): import("../types").Offer {
    const offer = this.offers.find((o) => o.id === id);
    if (!offer) throw new Error("Offer not found.");
    Object.assign(offer, patch, { updated_at: new Date().toISOString() });
    return offer;
  }

  async withdrawOffer(offerId: number): Promise<import("../types").Offer> {
    const offer = this.patchOffer(offerId, { status: "withdrawn", responded_at: new Date().toISOString() });
    return offer;
  }

  async respondOffer(
    offerId: number,
    action: "accept" | "decline" | "counter",
    amount?: number,
    message?: string,
  ): Promise<import("../types").Offer> {
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer) throw new Error("Offer not found.");
    const auction = this.findAuction(offer.auction_id);
    const now = new Date().toISOString();
    if (action === "accept") {
      if (auction) {
        auction.status = "sold";
        auction.current_price = offer.amount;
        bus.emit("auction:update", { auction });
      }
      return this.patchOffer(offerId, { status: "accepted", responded_at: now });
    }
    if (action === "counter") {
      return this.patchOffer(offerId, {
        status: "countered",
        counter_amount: round2(amount ?? offer.amount),
        counter_message: message ?? null,
        responded_at: now,
      });
    }
    return this.patchOffer(offerId, { status: "declined", responded_at: now });
  }

  async acceptCounter(offerId: number, accept: boolean): Promise<import("../types").Offer> {
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer) throw new Error("Offer not found.");
    const auction = this.findAuction(offer.auction_id);
    const now = new Date().toISOString();
    if (accept) {
      if (auction) {
        auction.status = "sold";
        auction.current_price = offer.counter_amount ?? offer.amount;
        bus.emit("auction:update", { auction });
      }
      return this.patchOffer(offerId, { status: "accepted", responded_at: now });
    }
    return this.patchOffer(offerId, { status: "declined", responded_at: now });
  }

  async retractBid(bidId: number, reason: string): Promise<{ auction: Auction | null }> {
    if (reason.trim().length < 10) throw new Error("Give a reason (at least 10 characters).");
    const bid = this.seed.bids.find((b) => b.id === bidId);
    if (!bid) throw new Error("Bid not found.");
    if (bid.status !== "active") throw new Error("Only the current leading bid can be retracted.");
    bid.status = "retracted";
    bid.retracted_at = new Date().toISOString();
    bid.retraction_reason = reason;
    const auction = this.findAuction(bid.auction_id) ?? null;
    if (auction) {
      const prev = this.seed.bids
        .filter((b) => b.auction_id === auction.id && b.id < bid.id && b.status === "superseded")
        .sort((a, b) => b.id - a.id)[0];
      if (prev) prev.status = "active";
      auction.current_price = prev ? prev.amount : auction.start_price;
      auction.bid_count = Math.max(0, auction.bid_count - 1);
      bus.emit("auction:update", { auction });
    }
    return { auction };
  }

  async featureListing(auctionId: number): Promise<Auction> {
    const auction = this.findAuction(auctionId);
    if (!auction) throw new Error("Listing not found.");
    if (auction.featured === 1) throw new Error("This listing is already featured.");
    auction.featured = 1;
    bus.emit("auction:update", { auction });
    return auction;
  }

  async liveSessions(): Promise<import("../types").LiveSession[]> {
    return [...this.rooms].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  }

  async liveSession(id: number): Promise<import("../types").LiveSession | null> {
    return this.rooms.find((r) => r.id === id) ?? null;
  }

  async createLiveRoom(input: { title: string; scheduledAt?: string }): Promise<import("../types").LiveSession> {
    const me = this.me();
    if (!me) throw new Error("Sign in to host a live room.");
    const now = new Date().toISOString();
    const room: import("../types").LiveSession = {
      id: this.nextRoomId++,
      host_user: me.id,
      host_username: me.username,
      title: input.title.slice(0, 120),
      scheduled_at: input.scheduledAt ?? now,
      status: "scheduled",
      current_lot_id: null,
      lot_index: 0,
      close_at: null,
      created_at: now,
      updated_at: now,
    };
    this.rooms.unshift(room);
    return room;
  }

  async addRoomLot(sessionId: number, auctionId: number): Promise<void> {
    const room = this.rooms.find((r) => r.id === sessionId);
    const auction = this.findAuction(auctionId);
    if (!room || !auction) throw new Error("Room or listing not found.");
    if (auction.bid_count > 0) throw new Error("Only listings without bids can be auctioned live.");
    auction.live_session_id = sessionId;
    auction.ends_at = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    bus.emit("auction:update", { auction });
  }

  async removeRoomLot(sessionId: number, auctionId: number): Promise<void> {
    const room = this.rooms.find((r) => r.id === sessionId);
    const auction = this.findAuction(auctionId);
    if (!room || !auction) throw new Error("Room or listing not found.");
    if (room.current_lot_id === auctionId) throw new Error("Close the current lot first.");
    auction.live_session_id = null;
    auction.ends_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    bus.emit("auction:update", { auction });
  }

  async openRoomLot(sessionId: number, auctionId?: number): Promise<import("../types").LiveSession> {
    const room = this.rooms.find((r) => r.id === sessionId);
    if (!room) throw new Error("Live room not found.");
    const lots = this.seed.auctions.filter((a) => a.live_session_id === sessionId && a.status === "live");
    const lot = auctionId != null ? lots.find((l) => l.id === auctionId) : lots.find((l) => l.id !== room.current_lot_id);
    if (!lot) throw new Error("No more lots to open.");
    room.status = "live";
    room.current_lot_id = lot.id;
    room.lot_index += 1;
    room.close_at = null;
    room.updated_at = new Date().toISOString();
    return room;
  }

  async closeRoomLot(sessionId: number, sold: boolean): Promise<import("../types").LiveSession> {
    const room = this.rooms.find((r) => r.id === sessionId);
    if (!room || !room.current_lot_id) throw new Error("No lot is open in this room.");
    const lot = this.findAuction(room.current_lot_id);
    if (lot) {
      if (sold) {
        const active = this.seed.bids.find((b) => b.auction_id === lot.id && b.status === "active");
        if (!active) throw new Error("No bids to sell to.");
        lot.status = "sold";
        lot.current_price = active.amount;
      } else {
        lot.status = "ended";
      }
      bus.emit("auction:update", { auction: lot });
    }
    const remaining = this.seed.auctions.filter(
      (a) => a.live_session_id === sessionId && a.status === "live" && a.id !== room.current_lot_id,
    );
    if (remaining.length > 0) {
      room.current_lot_id = remaining[0].id;
      room.close_at = null;
    } else {
      room.status = "closed";
      room.current_lot_id = null;
      room.close_at = null;
    }
    room.updated_at = new Date().toISOString();
    return room;
  }

  async endLiveRoom(sessionId: number): Promise<import("../types").LiveSession> {
    const room = this.rooms.find((r) => r.id === sessionId);
    if (!room) throw new Error("Live room not found.");
    if (room.status === "live" && room.current_lot_id) throw new Error("Close the current lot first.");
    for (const lot of this.seed.auctions.filter((a) => a.live_session_id === sessionId && a.status === "live")) {
      lot.live_session_id = null;
      lot.ends_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      bus.emit("auction:update", { auction: lot });
    }
    room.status = "closed";
    room.current_lot_id = null;
    room.close_at = null;
    room.updated_at = new Date().toISOString();
    return room;
  }

  async roomLots(sessionId: number): Promise<Auction[]> {
    return this.seed.auctions.filter((a) => a.live_session_id === sessionId);
  }

  // IMP-05 is live-authority only. Explicit static demo exposes no synthetic
  // AuctionEvent data and rejects event/run-list writes rather than inventing it.
  async auctionEvents(): Promise<never[]> {
    return [];
  }

  async auctionEventBundle(_id: number): Promise<any> {
    return {
      event: null,
      venue: null,
      session: null,
      lots: [],
      operators: [],
      permissions: { operate: false, host: false, auctioneer: false, clerk: false, administer: false },
    };
  }

  async createAuctionEvent(_input: unknown): Promise<never> {
    throw new Error("Auction events require the canonical live Tengasell service.");
  }

  async grantEventOperator(
    _eventId: number,
    _username: string,
    _role: "AUCTIONEER" | "CLERK",
  ): Promise<never> {
    throw new Error("Event operator authority is unavailable in explicit demo mode.");
  }

  async runListCommand(_input: unknown): Promise<never> {
    throw new Error("Production run-list authority is unavailable in explicit demo mode.");
  }

  // engine-style sweep: ends auctions whose time passed (keeps demo honest)
  sweep() {
    const now = Date.now();
    for (const a of this.seed.auctions) {
      if (a.status === "live" && Date.parse(a.ends_at) <= now) {
        const active = this.seed.bids.find((b) => b.auction_id === a.id && b.status === "active");
        const reserveMet = a.reserve_price == null || (active ? active.amount : 0) >= a.reserve_price;
        if (active && reserveMet) {
          a.status = "sold";
          const order: Order = {
            id: this.nextOrderId++,
            auction_id: a.id,
            auction_title: a.title,
            buyer_user: active.user,
            seller_user: a.user,
            buyer_username: active.bidder_username,
            seller_username: a.seller_username,
            final_price: active.amount,
            status: "pending_payment",
            pay_by: new Date(now + 48 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"),
            paid_at: null,
            shipped_at: null,
            delivered_at: null,
            completed_at: null,
            carrier: null,
            tracking: null,
            created_at: nowIso(),
            updated_at: nowIso(),
          };
          this.seed.orders.push(order);
          this.notifyUser(active.user, "won", "You won — payment due", `${a.title} at US$${active.amount}. Complete payment within 48h (SLA).`, `#/orders/${order.id}`);
          this.notifyUser(a.user, "sold", "Your auction sold", `${a.title} — US$${active.amount}.`, `#/orders/${order.id}`);
        } else {
          a.status = "ended";
          this.notifyUser(a.user, "info", "Auction ended unsold", a.title, `#/item/${a.id}`);
        }
        bus.emit("auction:ended", { auction: a });
      }
    }
  }
}
