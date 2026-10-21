"use client";

// Tengasell API entrypoint — picks the live TrailBase backend (Rust, port
// 3001) when reachable, else falls back to the local demo store so the
// experience degrades gracefully (NXS offline state) instead of breaking.

import { LocalStore } from "./local";
import { RemoteApi } from "./remote";
import type { Auction, AuctionQuery, Bid, BidResult, Category, CurrentUser, LiveSession, Message, Notification, Offer, Order, Paginated, Payment, Profile, Question, Rating, SavedSearch, SaveSearchInput, Thread } from "../types";

export type ApiMode = "live" | "demo";

export interface TengasellApi {
  register(username: string, password: string): Promise<{ ok: boolean; error?: string }>;
  login(username: string, password: string): Promise<{ ok: boolean; error?: string; user?: CurrentUser }>;
  logout(): Promise<void>;
  currentUser(): Promise<CurrentUser | null>;
  /** Adopt a session created by the gated sign-in (live mode only; demo no-op). */
  adoptExternalSession(a: { token: string; username: string }): void;
  /** Drop the in-memory + stored session (gated sign-out). */
  clearExternalSession(): void;
  categories(): Promise<Category[]>;
  auctions(q?: AuctionQuery): Promise<Paginated<Auction>>;
  auction(id: number): Promise<Auction | null>;
  bids(auctionId: number): Promise<Bid[]>;
  questions(auctionId: number): Promise<Question[]>;
  suggest(term: string): Promise<{ id: number; title: string; current_price: number }[]>;
  profile(username: string): Promise<Profile | null>;
  ratingsFor(username: string): Promise<Rating[]>;
  watchState(auctionId: number): Promise<boolean>;
  watch(auctionId: number, on: boolean): Promise<void>;
  watchlist(): Promise<Auction[]>;
  placeBid(auctionId: number, maxAmount: number): Promise<BidResult & { amount?: number }>;
  buyNow(auctionId: number, address?: string | null): Promise<{ orderId: number }>;
  askQuestion(auctionId: number, body: string): Promise<Question>;
  answerQuestion(questionId: number, body: string): Promise<Question>;
  createAuction(input: Parameters<RemoteApi["createAuction"]>[0]): Promise<Auction>;
  mySelling(): Promise<Auction[]>;
  myBids(): Promise<{ auction: Auction; myMax: number; winning: boolean; active: Bid | undefined }[]>;
  myWon(): Promise<Auction[]>;
  threads(): Promise<Thread[]>;
  threadMessages(threadId: number): Promise<Message[]>;
  sendMessage(input: { threadId?: number; auctionId?: number; toUsername?: string; body: string }): Promise<{ message: Message; thread: Thread }>;
  orders(role: "buying" | "selling"): Promise<Order[]>;
  order(id: number): Promise<Order | null>;
  paymentsFor(orderId: number): Promise<Payment[]>;
  payOrder(orderId: number, method: string, reference?: string): Promise<Order>;
  markShipped(orderId: number, carrier: string, tracking: string): Promise<Order>;
  confirmDelivery(orderId: number): Promise<Order>;
  rateOrder(orderId: number, score: number, comment: string): Promise<Rating>;
  notifications(): Promise<Notification[]>;
  markNotificationsRead(): Promise<void>;
  logAudit(action: string, entity: string, entityId?: number, payload?: string, source?: string): Promise<void>;
  // ── Gap-8 ──────────────────────────────────────────────────────────
  /** Saved searches (user-owned) + alert toggles. */
  savedSearches(): Promise<SavedSearch[]>;
  saveSearch(input: SaveSearchInput): Promise<SavedSearch>;
  deleteSearch(id: number): Promise<void>;
  setSearchAlerts(id: number, on: boolean): Promise<void>;
  /** Best-Offer / haggle. */
  offersFor(auctionId: number): Promise<Offer[]>;
  myOffers(): Promise<Offer[]>;
  submitOffer(auctionId: number, amount: number, message?: string): Promise<Offer>;
  withdrawOffer(offerId: number): Promise<Offer>;
  respondOffer(offerId: number, action: "accept" | "decline" | "counter", amount?: number, message?: string): Promise<Offer>;
  acceptCounter(offerId: number, accept: boolean): Promise<Offer>;
  /** Bid retraction (60-minute window, lead bid only). */
  retractBid(bidId: number, reason: string): Promise<{ auction: Auction | null }>;
  /** Featured listing fee (US$2 + VAT, charged via finance). */
  featureListing(auctionId: number): Promise<Auction>;
  /** Live-room sessions. */
  liveSessions(): Promise<LiveSession[]>;
  liveSession(id: number): Promise<LiveSession | null>;
  createLiveRoom(input: { title: string; scheduledAt?: string }): Promise<LiveSession>;
  addRoomLot(sessionId: number, auctionId: number): Promise<void>;
  removeRoomLot(sessionId: number, auctionId: number): Promise<void>;
  openRoomLot(sessionId: number, auctionId?: number): Promise<LiveSession>;
  closeRoomLot(sessionId: number, sold: boolean): Promise<LiveSession>;
  endLiveRoom(sessionId: number): Promise<LiveSession>;
  /** Lots of a room (all auctions linked to the session). */
  roomLots(sessionId: number): Promise<Auction[]>;
}

let mode: ApiMode = "demo";
let impl: TengasellApi = new LocalStore() as unknown as TengasellApi;
let initialized = false;
const modeListeners = new Set<(m: ApiMode) => void>();

async function probeRemote(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `/api/records/v1/categories?limit=1&XTransformPort=3001`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Boot the API layer — call once from the app shell. */
export async function initApi(): Promise<ApiMode> {
  if (initialized) return mode;
  initialized = true;
  const remoteAvailable = await probeRemote();
  if (remoteAvailable) {
    mode = "live";
    impl = new RemoteApi() as unknown as TengasellApi;
  } else {
    mode = "demo";
    impl = new LocalStore() as unknown as TengasellApi;
  }
  modeListeners.forEach((fn) => fn(mode));
  return mode;
}

export function getApiMode(): ApiMode {
  return mode;
}

export function onApiMode(fn: (m: ApiMode) => void): () => void {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

/** The active API implementation (live TrailBase or local demo). */
export const api: TengasellApi = new Proxy({} as TengasellApi, {
  get(_target, prop: string) {
    const anyImpl = impl as unknown as Record<string, unknown>;
    const value = anyImpl[prop];
    if (typeof value === "function") {
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(impl, args);
    }
    return value;
  },
});

/** Demo-mode housekeeping (auction ending sweep in the local store). */
export function demoSweep() {
  if (mode === "demo" && impl instanceof LocalStore === false) return;
  const store = impl as unknown as LocalStore;
  if (typeof store.sweep === "function") store.sweep();
}
