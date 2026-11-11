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
  | "AUTH_REVOKED"
  | "PROFILE_MISSING";

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

export interface RevocationPersistence {
  recordTokenRevocation: (digest: string, expMs: number) => void;
  recordSubjectRevocation: (subjectKey: string, cutoffSec: number, nowMs: number) => void;
  isTokenRevoked: (digest: string, subjectKeys: string[], claimsIat: number | undefined, nowMs: number) => boolean;
  close?: () => void;
}

export interface IdentityResolverDeps {
  fetchStatus: (token: string) => Promise<StatusResponse>;
  lookupProfile: (
    sub: string,
    username: string,
  ) => Promise<{ user: string; username: string } | null>;
  checkCanonicalUserSession?: (claims: JwtClaims, nowMs: number) => CanonicalCheckResult;
  revocationStore?: RevocationPersistence;
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

export function openRevocationStore(dbPath: string): RevocationPersistence {
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath, { create: true, readwrite: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      digest TEXT PRIMARY KEY,
      exp_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens (exp_ms);
    CREATE TABLE IF NOT EXISTS revoked_subjects (
      subject_key TEXT PRIMARY KEY,
      cutoff_sec INTEGER NOT NULL,
      updated_ms INTEGER NOT NULL
    );
  `);

  return {
    recordTokenRevocation: (digest, expMs) => {
      db.query(
        "INSERT INTO revoked_tokens (digest, exp_ms) VALUES (?, ?) ON CONFLICT(digest) DO UPDATE SET exp_ms = MAX(revoked_tokens.exp_ms, excluded.exp_ms)",
      ).run(digest, Math.trunc(expMs));
    },
    recordSubjectRevocation: (subjectKey, cutoffSec, nowMs) => {
      db.query(
        "INSERT INTO revoked_subjects (subject_key, cutoff_sec, updated_ms) VALUES (?, ?, ?) ON CONFLICT(subject_key) DO UPDATE SET cutoff_sec = MAX(revoked_subjects.cutoff_sec, excluded.cutoff_sec), updated_ms = excluded.updated_ms",
      ).run(subjectKey, Math.trunc(cutoffSec), Math.trunc(nowMs));
    },
    isTokenRevoked: (digest, subjectKeys, claimsIat, nowMs) => {
      const tokRow = db
        .query("SELECT 1 AS ok FROM revoked_tokens WHERE digest = ? AND exp_ms > ? LIMIT 1")
        .get(digest, nowMs) as { ok?: number } | null;
      if (tokRow) return true;
      for (const subjectKey of subjectKeys) {
        const subRow = db
          .query("SELECT cutoff_sec FROM revoked_subjects WHERE subject_key = ? LIMIT 1")
          .get(subjectKey) as { cutoff_sec?: number } | null;
        if (!subRow || typeof subRow.cutoff_sec !== "number") continue;
        if (typeof claimsIat !== "number" || !Number.isFinite(claimsIat) || claimsIat <= subRow.cutoff_sec) {
          return true;
        }
      }
      return false;
    },
    close: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Read-only canonical lookup against TrailBase's SQLite stores:
 *  - main.db (_user): detects deleted accounts, username changes, or admin demotion
 *  - session.db (_session): detects TrailBase logouts before the JWT's exp elapses (fails closed if missing/unreadable)
 */
export function openCanonicalTrailBaseStore(dataDir: string): CanonicalTrailBaseStore {
  const mainPath = path.join(dataDir, "main.db");
  const sessionPath = path.join(dataDir, "session.db");

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

    // Fail closed whenever session.db is missing or unreadable: unavailable
    // revocation evidence must never silently grant permission to bid.
    const sdb = ensureSessionDb();
    if (!sdb) {
      return { valid: false, code: "AUTH_REVOKED" };
    }

    // Require finite numeric iat — never fall back to nowSec.
    if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat)) {
      return { valid: false, code: "AUTH_REVOKED" };
    }

    const nowSec = Math.floor(nowMs / 1000);
    // TrailBase inserts _session before signing auth_token (so created <= token.iat,
    // including across subsequent refreshes). Matching created <= floor(iat) blocks
    // pre-logout tokens once a newer session starts in a later second.
    const iatUpper = Math.floor(claims.iat);
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
    const keys = this.subjectKeys(claims.sub, claims.username);
    for (const key of keys) {
      const cutoff = this.revokedBeforeBySubject.get(key);
      if (cutoff === undefined) continue;
      if (typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat <= cutoff) {
        return true;
      }
    }
    if (this.deps.revocationStore) {
      try {
        if (this.deps.revocationStore.isTokenRevoked(tokenDigest, keys, claims.iat, nowMs)) {
          return true;
        }
      } catch {
        // Fail closed if persistent revocation lookup fails
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
    if (this.revokedTokens.has(digest)) this.revokedTokens.delete(digest);
    while (this.revokedTokens.size >= this.maxRevokedEntries) {
      const oldestKey = this.revokedTokens.keys().next().value;
      if (!oldestKey) break;
      this.revokedTokens.delete(oldestKey);
    }
    this.revokedTokens.set(digest, expMs);
    this.cache.delete(digest);
    try {
      this.deps.revocationStore?.recordTokenRevocation(digest, expMs);
    } catch {
      /* in-memory revocation still recorded; persistent failure logged by caller */
    }
    return true;
  }

  private setSubjectRevocation(subjectKey: string, cutoff: number, nowMs: number): void {
    const prev = this.revokedBeforeBySubject.get(subjectKey) ?? -Infinity;
    const nextCutoff = Math.max(prev, cutoff);
    if (this.revokedBeforeBySubject.has(subjectKey)) {
      this.revokedBeforeBySubject.delete(subjectKey);
    }
    while (this.revokedBeforeBySubject.size >= this.maxRevokedEntries) {
      const oldestKey = this.revokedBeforeBySubject.keys().next().value;
      if (!oldestKey) break;
      this.revokedBeforeBySubject.delete(oldestKey);
    }
    this.revokedBeforeBySubject.set(subjectKey, nextCutoff);
    try {
      this.deps.revocationStore?.recordSubjectRevocation(subjectKey, nextCutoff, nowMs);
    } catch {
      /* ignore */
    }
  }

  revokeSubject(target: { sub?: string; username?: string }, cutoffSec?: number): void {
    const nowMs = this.nowMsFn();
    const cutoff = cutoffSec ?? Math.floor(nowMs / 1000);
    if (target.sub) {
      this.setSubjectRevocation(`sub:${target.sub}`, cutoff, nowMs);
    }
    if (target.username) {
      this.setSubjectRevocation(`user:${target.username.toLowerCase()}`, cutoff, nowMs);
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

    if (!profile || !profile.user || profile.user !== verified.sub || profile.username !== verified.username) {
      this.cache.delete(digest);
      this.cache.delete(activeDigest);
      return {
        ok: false,
        code: !profile ? "PROFILE_MISSING" : "AUTH_INVALID",
        error: !profile
          ? "Account profile missing — reload and retry."
          : "Account profile mismatch.",
      };
    }

    const identity: Identity = {
      id: profile.user,
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
