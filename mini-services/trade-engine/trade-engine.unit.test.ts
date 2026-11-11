import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  IdentityResolver,
  openCanonicalTrailBaseStore,
  openRevocationStore,
  parseStrictJwt,
  sha256Hex,
  timingSafeEqualStr,
  validateClaimTimestamps,
  type CanonicalCheckResult,
  type JwtClaims,
} from "./auth";
import {
  AuctionLockMap,
  BidService,
  bidIncrement,
  preCommitError,
  uncertainBidOutcome,
  type BidOutcome,
  type BiddingStore,
} from "./bidding";

function b64UrlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function buildJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "EdDSA", typ: "JWT" },
  sig = "synthetic-sig-bytes",
): string {
  return `${b64UrlJson(header)}.${b64UrlJson(payload)}.${sig}`;
}

function uuidBytes(base64Sub: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64Sub, "base64"));
}

function makeUuidSub(): string {
  const hex = randomUUID().replace(/-/g, "");
  return Buffer.from(hex, "hex").toString("base64");
}

/**
 * Mirrors mobile PR #9 `parseBidAck` (`mobile/src/lib/bid-ack.ts`) contract assertions
 * so backend changes stay compatible with both Mobile and Web (`socket.ts`).
 */
function classifyClientAck(ack: BidOutcome): "accepted" | "rejected" | "uncertain" {
  if (ack.ok === true) return "accepted";
  if (ack.committed === false || ack.rejected === true || ack.stage === "pre_commit") {
    return "rejected";
  }
  return "uncertain";
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("trade-engine auth unit tests", () => {
  test("1. parseStrictJwt accepts valid JWT structure and rejects unsigned/malformed tokens", () => {
    const sub = makeUuidSub();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const valid = buildJwt({ sub, username: "nyasha", admin: false, exp, iat: exp - 3600 });
    const parsed = parseStrictJwt(valid);
    expect(parsed).toEqual({
      alg: "EdDSA",
      sub,
      username: "nyasha",
      admin: false,
      exp,
      iat: exp - 3600,
    });

    // alg: none attack
    expect(parseStrictJwt(buildJwt({ sub, username: "nyasha", exp }, { alg: "none" }, "sig"))).toBeNull();
    // missing signature
    expect(parseStrictJwt(`${b64UrlJson({ alg: "EdDSA" })}.${b64UrlJson({ sub, username: "nyasha", exp })}.`)).toBeNull();
    // non-3 segments
    expect(parseStrictJwt("only.two")).toBeNull();
    // surrounding whitespace
    expect(parseStrictJwt(` ${valid}`)).toBeNull();
    // missing identity / exp fields
    expect(parseStrictJwt(buildJwt({ sub, exp }))).toBeNull();
    expect(parseStrictJwt(buildJwt({ sub, username: "nyasha" }))).toBeNull();
    // non-finite / float-garbage or wrong type
    expect(parseStrictJwt(buildJwt({ sub, username: "nyasha", exp: "soon" }))).toBeNull();
    expect(parseStrictJwt(null)).toBeNull();
    expect(parseStrictJwt("x".repeat(5000))).toBeNull();
  });

  test("2. validateClaimTimestamps enforces zero-leeway exp and rejects far-future nbf/iat", () => {
    const baseMs = 1_700_000_000_000;
    const nowSec = Math.floor(baseMs / 1000);
    const claims: JwtClaims = {
      alg: "EdDSA",
      sub: makeUuidSub(),
      username: "rufaro",
      admin: false,
      exp: nowSec + 60,
      iat: nowSec,
    };
    expect(validateClaimTimestamps(claims, baseMs)).toEqual({ ok: true });

    // exact boundary exp === nowSec is expired (zero leeway)
    expect(validateClaimTimestamps({ ...claims, exp: nowSec }, baseMs)).toMatchObject({
      ok: false,
      code: "AUTH_EXPIRED",
    });
    expect(validateClaimTimestamps({ ...claims, exp: nowSec - 1 }, baseMs)).toMatchObject({
      ok: false,
      code: "AUTH_EXPIRED",
    });
    // nbf far in future
    expect(validateClaimTimestamps({ ...claims, nbf: nowSec + 300 }, baseMs)).toMatchObject({
      ok: false,
      code: "AUTH_INVALID",
    });
    // iat far in future
    expect(validateClaimTimestamps({ ...claims, iat: nowSec + 300 }, baseMs)).toMatchObject({
      ok: false,
      code: "AUTH_INVALID",
    });
  });

  test("3. fail-closed: /api/auth/v1/status returning 200 with auth_token=null rejects structurally valid forged JWT", async () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const sub = makeUuidSub();
    const forged = buildJwt({ sub, username: "admin", admin: true, exp: nowSec + 3600, iat: nowSec });
    let profileLookups = 0;

    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({ ok: true, status: 200, authToken: null }),
      lookupProfile: async () => {
        profileLookups++;
        return { user: sub, username: "admin" };
      },
    });

    const res = await resolver.resolveWithReason(forged);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("AUTH_INVALID");
    expect(await resolver.resolve(forged)).toBeNull();
    expect(profileLookups).toBe(0);
  });

  test("4. fail-closed on upstream HTTP 500, network throw, or claimed sub/username mismatch", async () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const sub = makeUuidSub();
    const token = buildJwt({ sub, username: "nyasha", admin: false, exp: nowSec + 600, iat: nowSec });

    const on500 = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({ ok: false, status: 500, authToken: null }),
      lookupProfile: async () => ({ user: sub, username: "nyasha" }),
    });
    expect((await on500.resolveWithReason(token)).ok).toBe(false);

    const onThrow = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => {
        throw new Error("ECONNREFUSED");
      },
      lookupProfile: async () => ({ user: sub, username: "nyasha" }),
    });
    expect((await onThrow.resolveWithReason(token)).ok).toBe(false);

    const swappedSub = makeUuidSub();
    const mismatched = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({
        ok: true,
        status: 200,
        authToken: buildJwt({ sub: swappedSub, username: "nyasha", admin: false, exp: nowSec + 600 }),
      }),
      lookupProfile: async () => ({ user: swappedSub, username: "nyasha" }),
    });
    const mmRes = await mismatched.resolveWithReason(token);
    expect(mmRes).toMatchObject({ ok: false, code: "AUTH_INVALID" });
  });

  test("5. fail-closed when profile lookup errors, mismatches, or returns null (PROFILE_MISSING)", async () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const sub = makeUuidSub();
    const token = buildJwt({ sub, username: "ghost", admin: false, exp: nowSec + 600, iat: nowSec });

    const onProfileErr = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({ ok: true, status: 200, authToken: token }),
      lookupProfile: async () => {
        throw new Error("503 Service Unavailable");
      },
    });
    expect(await onProfileErr.resolveWithReason(token)).toMatchObject({ ok: false, code: "AUTH_INVALID" });

    const onProfileMismatch = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({ ok: true, status: 200, authToken: token }),
      lookupProfile: async () => ({ user: makeUuidSub(), username: "ghost" }),
    });
    expect(await onProfileMismatch.resolveWithReason(token)).toMatchObject({ ok: false, code: "AUTH_INVALID" });

    const noProfile = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async () => ({ ok: true, status: 200, authToken: token }),
      lookupProfile: async () => null,
    });
    expect(await noProfile.resolveWithReason(token)).toMatchObject({
      ok: false,
      code: "PROFILE_MISSING",
    });
  });

  test("6. bounded LRU cache evicts oldest tokens, expires with TTL and exp, and forceFresh bypasses cache", async () => {
    let nowMs = 1_700_000_000_000;
    const nowSec = () => Math.floor(nowMs / 1000);
    let statusCalls = 0;

    const makeUserToken = (idx: number, ttlSec = 600) => {
      const sub = makeUuidSub();
      return {
        sub,
        username: `u${idx}`,
        token: buildJwt({
          sub,
          username: `u${idx}`,
          admin: false,
          exp: nowSec() + ttlSec,
          iat: nowSec(),
        }),
      };
    };

    const u1 = makeUserToken(1, 600);
    const u2 = makeUserToken(2, 600);
    const u3 = makeUserToken(3, 600);
    const u4 = makeUserToken(4, 2); // shorter exp (2s) than cache TTL (10s)

    const byToken = new Map([
      [u1.token, u1],
      [u2.token, u2],
      [u3.token, u3],
      [u4.token, u4],
    ]);

    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      cacheTtlMs: 10_000,
      maxCacheEntries: 2,
      fetchStatus: async (t) => {
        statusCalls++;
        return { ok: true, status: 200, authToken: byToken.has(t) ? t : null };
      },
      lookupProfile: async (sub, username) => ({ user: sub, username }),
    });

    expect((await resolver.resolveWithReason(u1.token)).ok).toBe(true);
    expect(statusCalls).toBe(1);
    // cached hit
    const hit = await resolver.resolveWithReason(u1.token);
    expect(hit).toMatchObject({ ok: true, fromCache: true });
    expect(statusCalls).toBe(1);
    // forceFresh bypasses cache
    const fresh = await resolver.resolveWithReason(u1.token, { forceFresh: true });
    expect(fresh).toMatchObject({ ok: true, fromCache: false });
    expect(statusCalls).toBe(2);

    // Fill cache beyond maxCacheEntries=2 -> u1 evicted once u2 and u3 are added
    await resolver.resolveWithReason(u2.token);
    await resolver.resolveWithReason(u3.token);
    expect(resolver.cacheSize()).toBe(2);
    const u1Again = await resolver.resolveWithReason(u1.token);
    expect(u1Again).toMatchObject({ ok: true, fromCache: false });

    // Short exp evicts before cacheTtlMs expires
    await resolver.resolveWithReason(u4.token);
    nowMs += 2_500;
    const u4Expired = await resolver.resolveWithReason(u4.token);
    expect(u4Expired).toMatchObject({ ok: false, code: "AUTH_EXPIRED" });
  });

  test("7. in-memory revokeToken and revokeSubject cutoffs block stale tokens immediately", async () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const sub = makeUuidSub();
    const oldToken = buildJwt({ sub, username: "takudzwa", admin: false, exp: nowSec + 600, iat: nowSec - 10 });
    const newToken = buildJwt({ sub, username: "takudzwa", admin: false, exp: nowSec + 600, iat: nowSec + 5 });

    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      cacheTtlMs: 30_000,
      fetchStatus: async (t) => ({ ok: true, status: 200, authToken: t }),
      lookupProfile: async (s, u) => ({ user: s, username: u }),
    });

    expect((await resolver.resolveWithReason(oldToken)).ok).toBe(true);
    expect(resolver.revokeToken(oldToken)).toBe(true);
    expect(await resolver.resolveWithReason(oldToken)).toMatchObject({
      ok: false,
      code: "AUTH_REVOKED",
    });

    // Subject cutoff invalidates tokens <= nowSec, keeps newly issued token > nowSec
    const midToken = buildJwt({ sub, username: "takudzwa", admin: false, exp: nowSec + 600, iat: nowSec });
    expect((await resolver.resolveWithReason(midToken)).ok).toBe(true);
    resolver.revokeSubject({ sub, username: "takudzwa" }, nowSec);
    expect(await resolver.resolveWithReason(midToken)).toMatchObject({
      ok: false,
      code: "AUTH_REVOKED",
    });
    expect(await resolver.resolveWithReason(newToken)).toMatchObject({ ok: true });
  });

  test("8. openCanonicalTrailBaseStore detects logout, pre-relogin session mismatch, username change, deletion, and admin demotion", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "te-canon-unit-"));
    tempDirs.push(dir);
    const mainDbPath = path.join(dir, "main.db");
    const sessionDbPath = path.join(dir, "session.db");

    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const adminSub = makeUuidSub();
    const adminBytes = uuidBytes(adminSub);

    const mdb = new Database(mainDbPath);
    mdb.exec("CREATE TABLE _user (id BLOB PRIMARY KEY, username TEXT NOT NULL, admin INTEGER NOT NULL)");
    mdb.query("INSERT INTO _user (id, username, admin) VALUES (?, ?, ?)").run(adminBytes, "chief", 1);

    const sdb = new Database(sessionDbPath);
    sdb.exec(
      "CREATE TABLE _session (id BLOB PRIMARY KEY, user BLOB NOT NULL, refresh_token TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)",
    );
    sdb.query("INSERT INTO _session (id, user, refresh_token, created, expires) VALUES (?, ?, ?, ?, ?)").run(
      uuidBytes(makeUuidSub()),
      adminBytes,
      "r1",
      nowSec - 10,
      nowSec + 86400,
    );

    const store = openCanonicalTrailBaseStore(dir);
    const token = buildJwt({ sub: adminSub, username: "chief", admin: true, exp: nowSec + 600, iat: nowSec - 9 });

    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      cacheTtlMs: 60_000,
      fetchStatus: async (t) => ({ ok: true, status: 200, authToken: t }),
      lookupProfile: async (s, u) => ({ user: s, username: u }),
      checkCanonicalUserSession: store.check,
    });

    // Initial resolution succeeds as admin
    const initial = await resolver.resolveWithReason(token);
    expect(initial).toMatchObject({ ok: true, identity: { id: adminSub, username: "chief", admin: true } });

    // Admin demoted in canonical _user -> even cached resolution reflects admin=false
    mdb.query("UPDATE _user SET admin = 0 WHERE id = ?").run(adminBytes);
    const demoted = await resolver.resolveWithReason(token);
    expect(demoted).toMatchObject({ ok: true, identity: { admin: false }, fromCache: true });

    // Logout removes row from _session -> rejected immediately even with valid cached JWT
    sdb.query("DELETE FROM _session WHERE user = ?").run(adminBytes);
    expect(await resolver.resolveWithReason(token)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });

    // User re-logs in (new _session row created at nowSec + 20) -> OLD token before logout remains rejected!
    sdb.query("INSERT INTO _session (id, user, refresh_token, created, expires) VALUES (?, ?, ?, ?, ?)").run(
      uuidBytes(makeUuidSub()),
      adminBytes,
      "r2",
      nowSec + 20,
      nowSec + 86400,
    );
    expect(await resolver.resolveWithReason(token)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });

    // New token minted at nowSec + 20 passes canonical check
    const newToken = buildJwt({ sub: adminSub, username: "chief", admin: false, exp: nowSec + 620, iat: nowSec + 20 });
    expect(await resolver.resolveWithReason(newToken, { forceFresh: true })).toMatchObject({
      ok: true,
      identity: { username: "chief", admin: false },
    });

    // Username mutation invalidates token
    mdb.query("UPDATE _user SET username = 'renamed' WHERE id = ?").run(adminBytes);
    expect(await resolver.resolveWithReason(newToken)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });

    // User deletion invalidates token
    mdb.query("DELETE FROM _user WHERE id = ?").run(adminBytes);
    expect(await resolver.resolveWithReason(newToken)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });

    store.close();
    mdb.close();
    sdb.close();
  });

  test("9. helper primitives sha256Hex and timingSafeEqualStr behave consistently", () => {
    expect(sha256Hex("abc")).toHaveLength(64);
    expect(timingSafeEqualStr("secret-1", "secret-1")).toBe(true);
    expect(timingSafeEqualStr("secret-1", "secret-2")).toBe(false);
    expect(timingSafeEqualStr("short", "longer-str")).toBe(false);
    expect(preCommitError("AUTH_REQUIRED", "Sign in")).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
    });
    expect(uncertainBidOutcome("COMMIT_UNCERTAIN", "Timeout")).toMatchObject({
      ok: false,
      uncertain: true,
      stage: "commit_uncertain",
      reason: "unverified",
    });
  });
});

interface MockAuctionState {
  auction: any;
  bids: any[];
  nextBidId: number;
  audits: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  emittedAuctions: any[];
}

function createMockBiddingHarness(overrides?: Partial<BiddingStore> & { nowMs?: () => number }) {
  const nowMs = overrides?.nowMs ?? (() => 1_700_000_000_000);
  const state: MockAuctionState = {
    auction: {
      id: 42,
      user: "seller-sub",
      seller_username: "seller",
      title: "Copper Kettle",
      status: "live",
      start_price: 20,
      current_price: 20,
      bid_count: 0,
      ends_at: new Date(nowMs() + 3600_000).toISOString(),
      live_session_id: null,
    },
    bids: [],
    nextBidId: 100,
    audits: [],
    notifications: [],
    emittedAuctions: [],
  };

  const store: BiddingStore = {
    getAuction: async (id) =>
      id === state.auction.id
        ? { ok: true, row: { ...state.auction } }
        : { ok: false, notFound: true, error: "HTTP 404" },
    listBids: async (id) =>
      id === state.auction.id
        ? { ok: true, rows: [...state.bids].sort((a, b) => b.id - a.id) }
        : { ok: true, rows: [] },
    createBid: async (row) => {
      const id = state.nextBidId++;
      state.bids.push({ id, ...row });
      return { status: "created", id };
    },
    patchBid: async (bidId, patch) => {
      const target = state.bids.find((b) => b.id === bidId);
      if (!target) return false;
      Object.assign(target, patch);
      return true;
    },
    patchAuction: async (auctionId, patch) => {
      if (auctionId !== state.auction.id) return false;
      Object.assign(state.auction, patch);
      return true;
    },
    extendLiveRoom: async () => ({ session: null }),
    antiSnipe: async () => ({ auction: { ...state.auction } }),
    notifyBestEffort: async (userId, type, title, body, link) => {
      state.notifications.push({ userId, type, title, body, link });
      return true;
    },
    notifyWatchersBestEffort: async () => true,
    commsOutbidBestEffort: () => {},
    auditBestEffort: async (userId, action, entity, entityId, source, payload) => {
      state.audits.push({ userId, action, entity, entityId, source, payload });
      return true;
    },
    emitRoomUpdate: () => {},
    emitAuctionUpdate: (a) => state.emittedAuctions.push(a),
    ...overrides,
  };

  const service = new BidService(store, { nowMs });
  return { state, store, service };
}

describe("trade-engine bidding & commercial integrity unit tests", () => {
  const bidderA = { id: "bidder-a", username: "nyasha", admin: false };
  const bidderB = { id: "bidder-b", username: "rufaro", admin: false };
  const seller = { id: "seller-sub", username: "seller", admin: false };

  test("10. pre-commit validation errors never write bids and produce parseBidAck-safe rejected frames", async () => {
    const nowMs = 1_700_000_000_000;
    const { state, service } = createMockBiddingHarness({ nowMs: () => nowMs });

    const cases: Array<[any, string]> = [
      [{ user: bidderA, auctionId: -1, maxAmount: 25 }, "INVALID_AUCTION"],
      [{ user: { id: "", username: "x", admin: false }, auctionId: 42, maxAmount: 25 }, "PROFILE_MISSING"],
      [{ user: bidderA, auctionId: 999, maxAmount: 25 }, "AUCTION_NOT_FOUND"],
      [{ user: seller, auctionId: 42, maxAmount: 25 }, "SELF_BID"],
      [{ user: bidderA, auctionId: 42, maxAmount: 0 }, "INVALID_AMOUNT"],
      [{ user: bidderA, auctionId: 42, maxAmount: 19 }, "BELOW_START_PRICE"],
      [{ user: bidderA, auctionId: 42, maxAmount: 25, clientRequestId: "   " }, "INVALID_REQUEST_ID"],
    ];

    for (const [input, code] of cases) {
      const ack = await service.handleBidPlace(input);
      expect(ack).toMatchObject({ ok: false, committed: false, stage: "pre_commit", rejected: true, code });
      expect(classifyClientAck(ack)).toBe("rejected");
    }
    expect(state.bids).toHaveLength(0);
  });

  test("11. pre-commit upstream read failures (getAuction throw / listBids error) fail cleanly with committed=false", async () => {
    const { service: s1 } = createMockBiddingHarness({
      getAuction: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const r1 = await s1.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 30 });
    expect(r1).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "AUCTION_LOOKUP_FAILED",
    });

    const { service: s2 } = createMockBiddingHarness({
      listBids: async () => ({ ok: false, error: "HTTP 503" }),
    });
    const r2 = await s2.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 30 });
    expect(r2).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "BID_LEDGER_UNAVAILABLE",
    });
  });

  test("12. commit explicit 403/400 WRITE_REJECTED stays pre_commit; transport/502 ambiguity returns commit_uncertain", async () => {
    const { service: rejectedSvc } = createMockBiddingHarness({
      createBid: async () => ({ status: "rejected", statusCode: 403 }),
    });
    const rejAck = await rejectedSvc.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 30 });
    expect(rejAck).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "WRITE_REJECTED",
    });
    expect(classifyClientAck(rejAck)).toBe("rejected");

    const { service: throwSvc } = createMockBiddingHarness({
      createBid: async () => {
        throw new Error("socket hang up");
      },
    });
    const unc1 = await throwSvc.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 30 });
    expect(unc1).toMatchObject({
      ok: false,
      uncertain: true,
      stage: "commit_uncertain",
      reason: "unverified",
      code: "COMMIT_UNCERTAIN",
    });
    expect(unc1.committed).toBeUndefined();
    expect(unc1.rejected).toBeUndefined();
    expect(classifyClientAck(unc1)).toBe("uncertain");

    const { service: statusUncSvc } = createMockBiddingHarness({
      createBid: async () => ({ status: "uncertain", error: "HTTP 502" }),
    });
    const unc2 = await statusUncSvc.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 30 });
    expect(classifyClientAck(unc2)).toBe("uncertain");
  });

  test("13. uncertain commit followed by idempotent retry reconciles committed DB row without duplicate insert", async () => {
    let createCalls = 0;
    const harness = createMockBiddingHarness({
      createBid: async (row) => {
        createCalls++;
        // Simulate TrailBase committing the row before HTTP response drops
        const id = ++harness.state.nextBidId;
        harness.state.bids.push({ id, ...row });
        return { status: "uncertain", error: "socket reset after write" };
      },
    });

    const first = await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 55,
      clientRequestId: "req-ambig-1",
    });
    expect(first).toMatchObject({ ok: false, uncertain: true, stage: "commit_uncertain" });
    expect(createCalls).toBe(1);

    // Retry with same clientRequestId reconciles existing committed bid without second createBid
    const retry = await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 55,
      clientRequestId: "req-ambig-1",
    });
    expect(retry).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 20,
      winning: true,
      idempotentReplay: true,
    });
    expect(createCalls).toBe(1);
    expect(harness.state.bids).toHaveLength(1);
  });

  test("14. post-commit failures (audit, antiSnipe, notify, patchAuction) STILL return ok=true committed=true with warnings", async () => {
    const { state, service } = createMockBiddingHarness({
      auditBestEffort: async () => {
        throw new Error("audit ECONNRESET");
      },
      antiSnipe: async () => {
        throw new Error("antiSnipe 500");
      },
      notifyBestEffort: async () => false,
      notifyWatchersBestEffort: async () => false,
      patchAuction: async () => {
        throw new Error("summary sync failed");
      },
    });

    const ack = await service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 50,
      clientRequestId: "req-post-commit",
    });

    expect(state.bids).toHaveLength(1);
    expect(ack).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 20,
      winning: true,
      clientRequestId: "req-post-commit",
    });
    expect(ack.warnings).toEqual(
      expect.arrayContaining(["auction_summary_sync_failed", "anti_snipe_failed", "notify_failed", "audit_failed"]),
    );
    expect(classifyClientAck(ack)).toBe("accepted");
  });

  test("15. Yahoo proxy bidding advances standing max and sets outbid=true cleanly", async () => {
    const { state, service } = createMockBiddingHarness();

    const a1 = await service.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 100 });
    expect(a1).toMatchObject({ ok: true, committed: true, amount: 20, winning: true });

    // bidderB bids 35 -> standing proxy (100) defends at 35 + bidIncrement(20=1) = 36
    const b1 = await service.handleBidPlace({ user: bidderB, auctionId: 42, maxAmount: 35 });
    expect(b1).toMatchObject({ ok: true, committed: true, amount: 36, winning: false, outbid: true });

    // bidderB bids 150 -> overtakes standing max 100 at 100 + bidIncrement(36=1) = 101
    const b2 = await service.handleBidPlace({ user: bidderB, auctionId: 42, maxAmount: 150 });
    expect(b2).toMatchObject({ ok: true, committed: true, amount: 101, winning: true });
    expect(b2.outbid).toBeUndefined();
    expect(state.bids.filter((b) => b.status === "active")).toHaveLength(1);
    expect(state.auction.current_price).toBe(101);
  });

  test("16. idempotency replay returns committed ack once and rejects conflicting maxAmount on same clientRequestId", async () => {
    let creates = 0;
    const harness = createMockBiddingHarness();
    const origCreate = harness.store.createBid;
    harness.store.createBid = async (row) => {
      creates++;
      return origCreate(row);
    };

    const r1 = await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 45,
      clientRequestId: "idem-key-1",
    });
    const r2 = await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 45,
      clientRequestId: "idem-key-1",
    });
    expect(r1).toMatchObject({ ok: true, committed: true, amount: 20 });
    expect(r2).toMatchObject({ ok: true, committed: true, amount: 20, idempotentReplay: true });
    expect(creates).toBe(1);

    const conflict = await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 60,
      clientRequestId: "idem-key-1",
    });
    expect(conflict).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  test("17. AuctionLockMap serializes concurrent handleBidPlace calls on same auction without interleaving", async () => {
    const events: string[] = [];
    const harness = createMockBiddingHarness();
    const origList = harness.store.listBids;
    const origCreate = harness.store.createBid;

    harness.store.listBids = async (id) => {
      events.push("list");
      await delay(15);
      return origList(id);
    };
    harness.store.createBid = async (row) => {
      events.push(`create:${row.bidder_username}`);
      await delay(15);
      return origCreate(row);
    };

    const [aRes, bRes] = await Promise.all([
      harness.service.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 60 }),
      harness.service.handleBidPlace({ user: bidderB, auctionId: 42, maxAmount: 80 }),
    ]);

    expect(aRes).toMatchObject({ ok: true, committed: true, winning: true, amount: 20 });
    // Second serialized call sees bidderA's 20 active bid with max 60 and beats it at 60 + 1 = 61
    expect(bRes).toMatchObject({ ok: true, committed: true, winning: true, amount: 61 });
    expect(events).toEqual(["list", "create:nyasha", "list", "create:rufaro"]);
    expect(bidIncrement(20)).toBe(1);
    expect(bidIncrement(100)).toBe(2);
    expect(bidIncrement(600)).toBe(5);
    expect(bidIncrement(2000)).toBe(10);
    expect(bidIncrement(6000)).toBe(25);
  });

  test("18. AuctionLockMap cleanup drains lock entries after concurrent batch finishes", async () => {
    const locks = new AuctionLockMap();
    const order: number[] = [];
    await Promise.all([
      locks.run(7, async () => {
        await delay(10);
        order.push(1);
      }),
      locks.run(7, async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });

  test("19. canonical store requires finite iat and fails closed when session.db is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "te-failclosed-"));
    tempDirs.push(dir);
    const sub = makeUuidSub();
    const mdb = new Database(path.join(dir, "main.db"));
    mdb.exec("CREATE TABLE _user (id BLOB PRIMARY KEY, username TEXT NOT NULL, admin INTEGER NOT NULL)");
    mdb.query("INSERT INTO _user (id, username, admin) VALUES (?, ?, ?)").run(uuidBytes(sub), "alice", 0);
    mdb.close();

    // Missing session.db -> canonical store rejects cleanly (fail-closed)
    const storeNoSession = openCanonicalTrailBaseStore(dir);
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const withIat: JwtClaims = { alg: "EdDSA", sub, username: "alice", admin: false, exp: nowSec + 600, iat: nowSec };
    expect(storeNoSession.check(withIat, nowMs)).toMatchObject({ valid: false, code: "AUTH_REVOKED" });
    storeNoSession.close();

    // Valid session.db present, but token lacks iat -> rejected as AUTH_INVALID
    const sdb = new Database(path.join(dir, "session.db"));
    sdb.exec("CREATE TABLE _session (id BLOB PRIMARY KEY, user BLOB NOT NULL, refresh_token TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)");
    sdb.query("INSERT INTO _session (id, user, refresh_token, created, expires) VALUES (?, ?, ?, ?, ?)").run(
      uuidBytes(makeUuidSub()),
      uuidBytes(sub),
      "r1",
      nowSec - 5,
      nowSec + 86400,
    );
    sdb.close();

    const store = openCanonicalTrailBaseStore(dir);
    const noIat: JwtClaims = { alg: "EdDSA", sub, username: "alice", admin: false, exp: nowSec + 600 };
    expect(store.check(noIat, nowMs)).toMatchObject({ valid: false, code: "AUTH_REVOKED" });
    expect(store.check(withIat, nowMs)).toMatchObject({ valid: true });
    store.close();
  });

  test("20. <1s logout token revocation keeps immediate re-login working while revokeSubject invalidates both", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "te-subsec-"));
    tempDirs.push(dir);
    const sub = makeUuidSub();
    const subBytes = uuidBytes(sub);
    const nowMs = 1_700_000_000_500;
    const nowSec = Math.floor(nowMs / 1000);

    const mdb = new Database(path.join(dir, "main.db"));
    mdb.exec("CREATE TABLE _user (id BLOB PRIMARY KEY, username TEXT NOT NULL, admin INTEGER NOT NULL)");
    mdb.query("INSERT INTO _user (id, username, admin) VALUES (?, ?, ?)").run(subBytes, "tendai", 0);
    const sdb = new Database(path.join(dir, "session.db"));
    sdb.exec("CREATE TABLE _session (id BLOB PRIMARY KEY, user BLOB NOT NULL, refresh_token TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)");
    sdb.query("INSERT INTO _session (id, user, refresh_token, created, expires) VALUES (?, ?, ?, ?, ?)").run(
      uuidBytes(makeUuidSub()),
      subBytes,
      "r1",
      nowSec,
      nowSec + 86400,
    );

    const store = openCanonicalTrailBaseStore(dir);
    const token1 = buildJwt({ sub, username: "tendai", admin: false, exp: nowSec + 600, iat: nowSec, jti: "t1" });
    const token2 = buildJwt({ sub, username: "tendai", admin: false, exp: nowSec + 600, iat: nowSec, jti: "t2" });

    const revStore = openRevocationStore(path.join(dir, "tgs_revocations.db"));
    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async (t) => ({ ok: true, status: 200, authToken: t }),
      lookupProfile: async (s, u) => ({ user: s, username: u }),
      checkCanonicalUserSession: store.check,
      revocationStore: revStore,
    });

    // Logout deletes session and inserts new session within the SAME second (created === nowSec === iat)
    // and revokes ONLY token1 by digest.
    resolver.revokeToken(token1, (nowSec + 600) * 1000);
    expect(await resolver.resolveWithReason(token1)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });
    expect(await resolver.resolveWithReason(token2, { forceFresh: true })).toMatchObject({ ok: true });

    // Reopen revocation store & resolver to verify durable SQLite persistence across restarts
    revStore.close?.();
    const reopenedRev = openRevocationStore(path.join(dir, "tgs_revocations.db"));
    const resolver2 = new IdentityResolver({
      nowMs: () => nowMs,
      fetchStatus: async (t) => ({ ok: true, status: 200, authToken: t }),
      lookupProfile: async (s, u) => ({ user: s, username: u }),
      checkCanonicalUserSession: store.check,
      revocationStore: reopenedRev,
    });
    expect(await resolver2.resolveWithReason(token1)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });
    expect(await resolver2.resolveWithReason(token2)).toMatchObject({ ok: true });

    // Password reset / suspension revokes subject cutoff -> token2 at iat <= nowSec is now blocked
    resolver2.revokeSubject({ sub, username: "tendai" }, nowSec);
    expect(await resolver2.resolveWithReason(token2)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });

    reopenedRev.close?.();
    store.close();
    mdb.close();
    sdb.close();
  });

  test("21. IdentityResolver caps in-memory revoked entries cleanly under maxRevokedEntries", async () => {
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    const tokens = [1, 2, 3, 4].map((n) => {
      const sub = makeUuidSub();
      return {
        sub,
        username: `user${n}`,
        token: buildJwt({ sub, username: `user${n}`, admin: false, exp: nowSec + 600, iat: nowSec }),
      };
    });

    const resolver = new IdentityResolver({
      nowMs: () => nowMs,
      maxRevokedEntries: 2,
      fetchStatus: async (t) => ({ ok: true, status: 200, authToken: t }),
      lookupProfile: async (s, u) => ({ user: s, username: u }),
    });

    for (const item of tokens) {
      resolver.revokeSubject({ sub: item.sub, username: item.username }, nowSec);
    }
    // Latest 2 stay strictly revoked in bounded memory even without SQLite store
    expect(await resolver.resolveWithReason(tokens[2].token)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });
    expect(await resolver.resolveWithReason(tokens[3].token)).toMatchObject({ ok: false, code: "AUTH_REVOKED" });
  });

  test("22. BidService blocks ALREADY_LEADING self-outbid attempts without mutating ledger", async () => {
    const harness = createMockBiddingHarness();
    const first = await harness.service.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 60 });
    expect(first).toMatchObject({ ok: true, committed: true, amount: 20, winning: true });

    const selfHigher = await harness.service.handleBidPlace({ user: bidderA, auctionId: 42, maxAmount: 90 });
    expect(selfHigher).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "ALREADY_LEADING",
    });
    expect(harness.state.bids).toHaveLength(1);
    expect(harness.state.auction.current_price).toBe(20);
  });

  test("23. Proxy-outbid uncertain commit reconciles finalizeCommittedBid without clobbering standing winner or double-counting", async () => {
    const harness = createMockBiddingHarness();
    await harness.service.handleBidPlace({
      user: bidderA,
      auctionId: 42,
      maxAmount: 100,
      clientRequestId: "stand-a",
    });

    const origCreate = harness.store.createBid;
    let dropOnce = true;
    harness.store.createBid = async (row) => {
      const created = await origCreate(row);
      if (dropOnce) {
        dropOnce = false;
        // Simulate TrailBase committing challenger row just before socket drop (before patchBid/patchAuction run)
        return { status: "uncertain", error: "connection reset after insert" };
      }
      return created;
    };

    const unc = await harness.service.handleBidPlace({
      user: bidderB,
      auctionId: 42,
      maxAmount: 35,
      clientRequestId: "unc-outbid-1",
    });
    expect(unc).toMatchObject({
      ok: false,
      uncertain: true,
      stage: "commit_uncertain",
      code: "COMMIT_UNCERTAIN",
    });
    // Standing leader still shows old bid_count=1 and old amount=20 before reconciliation retry
    expect(harness.state.auction.current_price).toBe(20);
    expect(harness.state.auction.bid_count).toBe(1);

    // First retry reconciles outbid proxy state completely
    const retry1 = await harness.service.handleBidPlace({
      user: bidderB,
      auctionId: 42,
      maxAmount: 35,
      clientRequestId: "unc-outbid-1",
    });
    expect(retry1).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 36,
      winning: false,
      outbid: true,
      idempotentReplay: true,
    });
    expect(harness.state.auction.current_price).toBe(36);
    expect(harness.state.auction.bid_count).toBe(2);
    const activeRows = harness.state.bids.filter((b) => b.status === "active");
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].bidder_username).toBe("nyasha");
    expect(activeRows[0].amount).toBe(36);

    // Second retry replays deterministically without double-incrementing bid_count
    const retry2 = await harness.service.handleBidPlace({
      user: bidderB,
      auctionId: 42,
      maxAmount: 35,
      clientRequestId: "unc-outbid-1",
    });
    expect(retry2).toMatchObject({
      ok: true,
      committed: true,
      amount: 36,
      winning: false,
      outbid: true,
      idempotentReplay: true,
    });
    expect(harness.state.auction.bid_count).toBe(2);
  });
});
