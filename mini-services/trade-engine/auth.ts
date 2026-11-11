import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

export interface Identity {
  id: string; // canonical _user uuid (base64 in JSON)
  username: string;
  admin: boolean;
}

export interface JwtClaims {
  alg: string;
  sub: string;
  username: string;
  admin: boolean;
  exp: number;
  nbf?: number;
  iat?: number;
}

export type AuthErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "AUTH_REVOKED";

export type AuthResolution =
  | {
      ok: true;
      identity: Identity;
      claims: JwtClaims;
      fromCache: boolean;
    }
  | {
      ok: false;
      code: AuthErrorCode;
      error: string;
    };

export interface StatusResponse {
  ok: boolean;
  status: number;
  authToken: string | null;
}

export interface CanonicalCheckResult {
  valid: boolean;
  code?: AuthErrorCode;
  admin?: boolean;
}

export interface IdentityResolverDeps {
  fetchStatus: (token: string) => Promise<StatusResponse>;
  lookupProfile: (
    sub: string,
    username: string,
  ) => Promise<{ user: string; username: string } | null>;
  checkCanonicalUserSession?: (claims: JwtClaims, nowMs: number) => CanonicalCheckResult;
  nowMs?: () => number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  maxRevokedEntries?: number;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Strictly parses JWT structure and claims without verifying cryptographic signature.
 * Signature verification stays with TrailBase (/api/auth/v1/status), and this helper
 * rejects unsigned headers (alg=none), malformed segments, or missing identity/exp claims.
 */
export function parseStrictJwt(token: unknown): JwtClaims | null {
  if (typeof token !== "string") return null;
  if (token.length === 0 || token.length > 4096 || token.trim() !== token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, sigSeg] = parts;
  if (!headerSeg || !payloadSeg || !sigSeg || !/^[A-Za-z0-9_-]+$/.test(sigSeg)) {
    return null;
  }

  const header = decodeBase64UrlJson(headerSeg);
  const payload = decodeBase64UrlJson(payloadSeg);
  if (!header || !payload) return null;

  const alg = typeof header.alg === "string" ? header.alg.trim() : "";
  if (!alg || alg.toLowerCase() === "none") return null;

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  const exp = payload.exp;
  if (!sub || !username || typeof exp !== "number" || !Number.isFinite(exp)) return null;

  if (payload.nbf != null && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf))) {
    return null;
  }
  if (payload.iat != null && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat))) {
    return null;
  }

  return {
    alg,
    sub,
    username,
    admin: payload.admin === true,
    exp,
    ...(typeof payload.nbf === "number" ? { nbf: payload.nbf } : {}),
    ...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
  };
}

/** Reject expired or not-yet-valid tokens with zero clock leeway after exp. */
export function validateClaimTimestamps(
  claims: JwtClaims,
  nowMs: number,
): { ok: true } | { ok: false; code: AuthErrorCode; error: string } {
  if (claims.exp * 1000 <= nowMs) {
    return { ok: false, code: "AUTH_EXPIRED", error: "Your session has expired. Sign in again." };
  }
  if (claims.nbf != null && claims.nbf * 1000 > nowMs) {
    return {
      ok: false,
      code: "AUTH_INVALID",
      error: "Authentication token is not valid yet.",
    };
  }
  if (claims.iat != null && claims.iat * 1000 > nowMs + 60_000) {
    return {
      ok: false,
      code: "AUTH_INVALID",
      error: "Authentication token timestamp is invalid.",
    };
  }
  return { ok: true };
}

/** Locate TrailBase depot data directory when co-located with the trade engine. */
export function resolveTrailBaseDataDir(tradeEngineDir: string): string | null {
  const candidates = [
    process.env.TRAILBASE_DATA_DIR,
    process.env.TGS_DATA_DIR ? path.join(process.env.TGS_DATA_DIR, "traildepot", "data") : undefined,
    "/data/traildepot/data",
    path.resolve(tradeEngineDir, "../trailbase-db/traildepot/data"),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (fs.existsSync(path.join(dir, "main.db"))) return dir;
    } catch {
      /* ignore inaccessible candidate */
    }
  }
  return null;
}

export interface CanonicalTrailBaseStore {
  check: (claims: JwtClaims, nowMs: number) => CanonicalCheckResult;
  close: () => void;
}

/**
 * Read-only canonical lookup against TrailBase's SQLite stores:
 *  - main.db (_user): detects deleted accounts, username changes, or admin demotion
 *  - session.db (_session): detects TrailBase logouts before the JWT's exp elapses
 */
export function openCanonicalTrailBaseStore(dataDir: string): CanonicalTrailBaseStore {
  const mainPath = path.join(dataDir, "main.db");
  const sessionPath = path.join(dataDir, "session.db");
  const requireSessionDb = process.env.TRAILBASE_REQUIRE_SESSION_DB === "1";

  let mainDb: Database | null = null;
  let sessionDb: Database | null = null;

  const ensureMainDb = (): Database | null => {
    if (mainDb) return mainDb;
    if (!fs.existsSync(mainPath)) return null;
    mainDb = new Database(mainPath, { readonly: true });
    mainDb.exec("PRAGMA busy_timeout = 2000;");
    return mainDb;
  };

  const ensureSessionDb = (): Database | null => {
    if (sessionDb) return sessionDb;
    if (!fs.existsSync(sessionPath)) return null;
    sessionDb = new Database(sessionPath, { readonly: true });
    sessionDb.exec("PRAGMA busy_timeout = 2000;");
    return sessionDb;
  };

  const resetDb = () => {
    try {
      mainDb?.close();
    } catch {
      /* ignore */
    }
    try {
      sessionDb?.close();
    } catch {
      /* ignore */
    }
    mainDb = null;
    sessionDb = null;
  };

  const runCheck = (claims: JwtClaims, nowMs: number): CanonicalCheckResult => {
    let uidBytes: Uint8Array;
    try {
      uidBytes = new Uint8Array(Buffer.from(claims.sub, "base64"));
      if (uidBytes.length !== 16) return { valid: false, code: "AUTH_INVALID" };
    } catch {
      return { valid: false, code: "AUTH_INVALID" };
    }

    const mdb = ensureMainDb();
    if (!mdb) return { valid: false, code: "AUTH_INVALID" };
    const userRow = mdb
      .query("SELECT username, admin FROM _user WHERE id = ? LIMIT 1")
      .get(uidBytes) as { username?: string | null; admin?: number | boolean } | null;

    if (!userRow || userRow.username !== claims.username) {
      return { valid: false, code: "AUTH_REVOKED" };
    }

    const sdb = ensureSessionDb();
    if (!sdb) {
      if (requireSessionDb) return { valid: false, code: "AUTH_REVOKED" };
      return { valid: true, admin: Boolean(userRow.admin) };
    }

    const nowSec = Math.floor(nowMs / 1000);
    // TrailBase inserts _session before signing auth_token (so created <= token.iat,
    // including across subsequent refreshes). Matching created <= floor(iat) blocks
    // pre-logout tokens once a newer session starts in a later second.
    const iatUpper = typeof claims.iat === "number" ? Math.floor(claims.iat) : nowSec;
    const sess = sdb
      .query(
        "SELECT 1 AS ok FROM _session WHERE user = ? AND expires > ? AND created <= ? LIMIT 1",
      )
      .get(uidBytes, nowSec, iatUpper) as { ok?: number } | null;

    if (!sess) {
      return { valid: false, code: "AUTH_REVOKED" };
    }

    return { valid: true, admin: Boolean(userRow.admin) };
  };

  return {
    check: (claims: JwtClaims, nowMs: number): CanonicalCheckResult => {
      try {
        return runCheck(claims, nowMs);
      } catch {
        resetDb();
        try {
          return runCheck(claims, nowMs);
        } catch {
          return { valid: false, code: "AUTH_INVALID" };
        }
      }
    },
    close: resetDb,
  };
}

interface CachedIdentity {
  identity: Identity;
  claims: JwtClaims;
  expiresAtMs: number;
}

export class IdentityResolver {
  private readonly cache = new Map<string, CachedIdentity>();
  private readonly revokedTokens = new Map<string, number>(); // token sha256 → expMs
  private readonly revokedBeforeBySubject = new Map<string, number>(); // sub or username → unix sec
  private readonly nowMsFn: () => number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly maxRevokedEntries: number;

  constructor(private readonly deps: IdentityResolverDeps) {
    this.nowMsFn = deps.nowMs ?? (() => Date.now());
    this.cacheTtlMs = Math.max(0, deps.cacheTtlMs ?? 5_000);
    this.maxCacheEntries = Math.max(1, deps.maxCacheEntries ?? 512);
    this.maxRevokedEntries = Math.max(16, deps.maxRevokedEntries ?? 2048);
  }

  private subjectKeys(sub: string, username: string): string[] {
    return [`sub:${sub}`, `user:${username.toLowerCase()}`];
  }

  isTokenRevoked(tokenDigest: string, claims: JwtClaims, nowMs: number): boolean {
    const expMs = this.revokedTokens.get(tokenDigest);
    if (expMs !== undefined) {
      if (expMs > nowMs) return true;
      this.revokedTokens.delete(tokenDigest);
    }
    for (const key of this.subjectKeys(claims.sub, claims.username)) {
      const cutoff = this.revokedBeforeBySubject.get(key);
      if (cutoff === undefined) continue;
      if (typeof claims.iat !== "number" || claims.iat <= cutoff) {
        return true;
      }
    }
    return false;
  }

  revokeToken(token: string, expMsOverride?: number): boolean {
    if (typeof token !== "string" || !token) return false;
    const digest = sha256Hex(token);
    const parsed = parseStrictJwt(token);
    const expMs = expMsOverride ?? (parsed ? parsed.exp * 1000 : this.nowMsFn() + 86_400_000);
    this.pruneRevocations();
    if (this.revokedTokens.size >= this.maxRevokedEntries) {
      const oldestKey = this.revokedTokens.keys().next().value;
      if (oldestKey) this.revokedTokens.delete(oldestKey);
    }
    this.revokedTokens.set(digest, expMs);
    this.cache.delete(digest);
    return true;
  }

  revokeSubject(target: { sub?: string; username?: string }, cutoffSec?: number): void {
    const cutoff = cutoffSec ?? Math.floor(this.nowMsFn() / 1000);
    if (target.sub) {
      const k = `sub:${target.sub}`;
      const prev = this.revokedBeforeBySubject.get(k) ?? -Infinity;
      this.revokedBeforeBySubject.set(k, Math.max(prev, cutoff));
    }
    if (target.username) {
      const k = `user:${target.username.toLowerCase()}`;
      const prev = this.revokedBeforeBySubject.get(k) ?? -Infinity;
      this.revokedBeforeBySubject.set(k, Math.max(prev, cutoff));
    }
    for (const [digest, entry] of this.cache.entries()) {
      if (
        (target.sub && entry.claims.sub === target.sub) ||
        (target.username && entry.claims.username.toLowerCase() === target.username.toLowerCase())
      ) {
        this.cache.delete(digest);
      }
    }
  }

  private pruneRevocations(): void {
    const nowMs = this.nowMsFn();
    for (const [digest, expMs] of this.revokedTokens.entries()) {
      if (expMs <= nowMs) this.revokedTokens.delete(digest);
    }
  }

  private setCache(digest: string, entry: CachedIdentity): void {
    if (this.cacheTtlMs <= 0) return;
    if (this.cache.has(digest)) this.cache.delete(digest);
    while (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(digest, entry);
  }

  cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async resolveWithReason(
    token: unknown,
    opts?: { forceFresh?: boolean },
  ): Promise<AuthResolution> {
    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." };
    }
    const nowMs = this.nowMsFn();
    const presented = parseStrictJwt(token);
    if (!presented) {
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Authentication could not be verified. Please sign in again.",
      };
    }

    const timeCheck = validateClaimTimestamps(presented, nowMs);
    if (!timeCheck.ok) return timeCheck;

    const digest = sha256Hex(token);
    if (this.isTokenRevoked(digest, presented, nowMs)) {
      return {
        ok: false,
        code: "AUTH_REVOKED",
        error: "Your session has been signed out. Please sign in again.",
      };
    }

    if (!opts?.forceFresh && this.cacheTtlMs > 0) {
      const cached = this.cache.get(digest);
      if (cached) {
        if (cached.expiresAtMs <= nowMs || cached.claims.exp * 1000 <= nowMs) {
          this.cache.delete(digest);
        } else {
          if (this.deps.checkCanonicalUserSession) {
            const canon = this.deps.checkCanonicalUserSession(cached.claims, nowMs);
            if (!canon.valid) {
              this.cache.delete(digest);
              const code = canon.code ?? "AUTH_REVOKED";
              if (code === "AUTH_REVOKED") {
                this.revokeToken(token, cached.claims.exp * 1000);
              }
              return {
                ok: false,
                code,
                error: "Your session is no longer valid. Please sign in again.",
              };
            }
            if (typeof canon.admin === "boolean") {
              cached.identity = { ...cached.identity, admin: canon.admin };
            }
          }
          return { ok: true, identity: cached.identity, claims: cached.claims, fromCache: true };
        }
      }
    }

    let status: StatusResponse;
    try {
      status = await this.deps.fetchStatus(token);
    } catch {
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Authentication authority is unreachable. Please retry.",
      };
    }

    // Fail closed: TrailBase /api/auth/v1/status returns HTTP 200 with auth_token: null
    // when a token is forged, expired, or malformed. NEVER fall back to caller token.
    if (!status.ok || typeof status.authToken !== "string" || !status.authToken) {
      this.cache.delete(digest);
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Your session is not valid. Please sign in again.",
      };
    }

    const verified = parseStrictJwt(status.authToken);
    if (!verified) {
      this.cache.delete(digest);
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Authentication token failed validation.",
      };
    }
    const verifiedTime = validateClaimTimestamps(verified, nowMs);
    if (!verifiedTime.ok) {
      this.cache.delete(digest);
      return verifiedTime;
    }

    if (verified.sub !== presented.sub || verified.username !== presented.username) {
      this.cache.delete(digest);
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Authentication identity mismatch.",
      };
    }

    const activeDigest = sha256Hex(status.authToken);
    if (
      this.isTokenRevoked(digest, verified, nowMs) ||
      this.isTokenRevoked(activeDigest, verified, nowMs)
    ) {
      this.cache.delete(digest);
      this.cache.delete(activeDigest);
      return {
        ok: false,
        code: "AUTH_REVOKED",
        error: "Your session has been signed out. Please sign in again.",
      };
    }

    let canonicalAdmin = verified.admin;
    if (this.deps.checkCanonicalUserSession) {
      const canon = this.deps.checkCanonicalUserSession(verified, nowMs);
      if (!canon.valid) {
        this.cache.delete(digest);
        this.cache.delete(activeDigest);
        const code = canon.code ?? "AUTH_REVOKED";
        if (code === "AUTH_REVOKED") {
          this.revokeToken(token, verified.exp * 1000);
          if (status.authToken !== token) {
            this.revokeToken(status.authToken, verified.exp * 1000);
          }
        }
        return {
          ok: false,
          code,
          error: "Your session is no longer valid. Please sign in again.",
        };
      }
      if (typeof canon.admin === "boolean") canonicalAdmin = canon.admin;
    }

    let profile: { user: string; username: string } | null = null;
    try {
      profile = await this.deps.lookupProfile(verified.sub, verified.username);
    } catch {
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Could not verify account profile. Please retry.",
      };
    }

    if (profile && (profile.user !== verified.sub || profile.username !== verified.username)) {
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Account profile mismatch.",
      };
    }

    const identity: Identity = {
      id: profile ? profile.user : "",
      username: verified.username,
      admin: canonicalAdmin,
    };

    const expiresAtMs = Math.min(verified.exp * 1000, nowMs + this.cacheTtlMs);
    const cacheEntry: CachedIdentity = { identity, claims: verified, expiresAtMs };
    this.setCache(digest, cacheEntry);
    if (activeDigest !== digest) this.setCache(activeDigest, cacheEntry);

    return { ok: true, identity, claims: verified, fromCache: false };
  }

  async resolve(token: unknown, opts?: { forceFresh?: boolean }): Promise<Identity | null> {
    const res = await this.resolveWithReason(token, opts);
    return res.ok ? res.identity : null;
  }
}
