import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

const ENGINE_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT_GUESS = path.resolve(ENGINE_DIR, "../..");
const BUN_BIN = process.execPath;

function resolveTrailBin(): string {
  const candidates = [
    process.env.TRAIL_BIN,
    path.join(REPO_ROOT_GUESS, ".tools/tb/trail"),
  ];
  try {
    const commonDir = spawnSync("git", ["-C", ENGINE_DIR, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
    });
    if (commonDir.status === 0) {
      const commonPath = commonDir.stdout.trim();
      const absCommon = path.isAbsolute(commonPath)
        ? commonPath
        : path.resolve(ENGINE_DIR, commonPath);
      candidates.push(path.resolve(absCommon, "..", ".tools/tb/trail"));
    }
  } catch {
    /* ignore */
  }
  const which = spawnSync("which", ["trail"], { encoding: "utf8" });
  if (which.status === 0) {
    const found = which.stdout.trim();
    if (found) candidates.push(found);
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate TrailBase 'trail' binary. Checked: ${candidates.filter(Boolean).join(", ")}`,
  );
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Failed to allocate ephemeral port"));
        return;
      }
      const port = addr.port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* retrying */
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for HTTP ${url}`);
}

async function stopChild(proc: ChildProcess | null | undefined): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  proc.kill("SIGTERM");
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && proc.exitCode === null) {
    await delay(50);
  }
  if (proc.exitCode === null) {
    proc.kill("SIGKILL");
  }
}

interface FaultState {
  failAuditMode: "none" | "reset" | "500";
  failAntiSnipeMode: "none" | "reset";
  createBidFault: "none" | "403" | "drop_after_forward" | "502_after_forward";
  forceNextAdminCall403: boolean;
  forwardCount: number;
}

function createFaultProxy(targetPort: number): Promise<{
  port: number;
  state: FaultState;
  close: () => Promise<void>;
}> {
  const state: FaultState = {
    failAuditMode: "none",
    failAntiSnipeMode: "none",
    createBidFault: "none",
    forceNextAdminCall403: false,
    forwardCount: 0,
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      const chunks: Buffer[] = [];
      clientReq.on("data", (c: Buffer) => chunks.push(c));
      clientReq.on("end", () => {
        const bodyBuf = Buffer.concat(chunks);
        const url = clientReq.url ?? "/";
        const method = clientReq.method ?? "GET";
        const bodyStr = bodyBuf.toString("utf8");

        if (
          state.forceNextAdminCall403 &&
          method === "GET" &&
          url.startsWith("/api/records/v1/auctions/") &&
          typeof clientReq.headers.authorization === "string"
        ) {
          state.forceNextAdminCall403 = false;
          clientRes.writeHead(403, { "Content-Type": "application/json" });
          clientRes.end(JSON.stringify({ error: "Injected transient 403" }));
          return;
        }

        if (method === "POST" && url === "/api/records/v1/audit_events") {
          if (state.failAuditMode === "reset") {
            clientReq.socket.destroy();
            return;
          }
          if (state.failAuditMode === "500") {
            clientRes.writeHead(500, { "Content-Type": "application/json" });
            clientRes.end(JSON.stringify({ error: "Injected audit 500" }));
            return;
          }
        }

        if (
          method === "PATCH" &&
          url.startsWith("/api/records/v1/auctions/") &&
          bodyStr.includes('"extension_count"') &&
          state.failAntiSnipeMode === "reset"
        ) {
          clientReq.socket.destroy();
          return;
        }

        if (method === "POST" && url === "/api/records/v1/bids") {
          if (state.createBidFault === "403") {
            clientRes.writeHead(403, { "Content-Type": "application/json" });
            clientRes.end(JSON.stringify({ error: "Injected 403 write block" }));
            return;
          }
        }

        state.forwardCount++;
        const bidAfterForwardMode =
          method === "POST" && url === "/api/records/v1/bids" &&
          (state.createBidFault === "drop_after_forward" || state.createBidFault === "502_after_forward")
            ? state.createBidFault
            : null;
        if (bidAfterForwardMode) {
          state.createBidFault = "none";
        }

        const upReq = http.request(
          {
            hostname: "127.0.0.1",
            port: targetPort,
            path: url,
            method,
            headers: {
              ...clientReq.headers,
              host: `127.0.0.1:${targetPort}`,
              "content-length": String(bodyBuf.length),
            },
          },
          (upRes) => {
            const resChunks: Buffer[] = [];
            upRes.on("data", (c: Buffer) => resChunks.push(c));
            upRes.on("end", () => {
              if (bidAfterForwardMode === "drop_after_forward") {
                clientReq.socket.destroy();
                return;
              }
              if (bidAfterForwardMode === "502_after_forward") {
                clientRes.writeHead(502, { "Content-Type": "application/json" });
                clientRes.end(JSON.stringify({ error: "Bad Gateway after upstream commit" }));
                return;
              }
              const resBuf = Buffer.concat(resChunks);
              const headers = { ...upRes.headers };
              delete headers["transfer-encoding"];
              headers["content-length"] = String(resBuf.length);
              clientRes.writeHead(upRes.statusCode ?? 500, headers);
              clientRes.end(resBuf);
            });
          },
        );
        upReq.on("error", () => {
          if (!clientRes.headersSent) {
            clientRes.writeHead(502);
            clientRes.end();
          }
        });
        upReq.end(bodyBuf);
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Proxy failed to bind"));
        return;
      }
      resolve({
        port: addr.port,
        state,
        close: () =>
          new Promise<void>((res) => {
            server.closeAllConnections?.();
            server.close(() => res());
          }),
      });
    });
  });
}

async function loginTrailBase(
  tbUrl: string,
  username: string,
  password: string,
): Promise<{ auth_token: string; refresh_token?: string }> {
  const res = await fetch(`${tbUrl}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login ${username} failed with HTTP ${res.status}`);
  }
  return (await res.json()) as { auth_token: string; refresh_token?: string };
}

function connectSocket(
  engineUrl: string,
  token?: string,
): Promise<{ socket: ClientSocket; hello: any }> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(engineUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      ...(token ? { auth: { token } } : {}),
    });
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        socket.close();
        reject(new Error("Timed out waiting for socket hello"));
      }
    }, 5000);

    socket.once("hello", (hello: any) => {
      resolved = true;
      clearTimeout(timer);
      resolve({ socket, hello });
    });
    socket.once("connect_error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function emitRpc<T = any>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event} ack`)), 8000);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function decodeClaims(token: string): { sub: string; username: string; admin: boolean; exp: number; iat?: number } {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function forgeUnsignedJwt(payload: Record<string, unknown>, alg = "none", sig = ""): string {
  const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${p}.${sig}`;
}

interface IsolatedStack {
  tmpDir: string;
  depotDir: string;
  dataDir: string;
  tbPort: number;
  tbUrl: string;
  proxyPort: number;
  proxyState: FaultState;
  tePort: number;
  teUrl: string;
  tbProc: ChildProcess;
  teProc: ChildProcess;
  closeProxy: () => Promise<void>;
  cleanup: () => Promise<void>;
}

async function bootIsolatedStack(opts?: {
  authTokenTtlSec?: number;
  cacheTtlMs?: number;
  internalSecret?: string;
}): Promise<IsolatedStack> {
  const trailBin = resolveTrailBin();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "te-int-"));
  const depotDir = path.join(tmpDir, "traildepot");
  const dataDir = path.join(depotDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const seedDb = path.join(REPO_ROOT_GUESS, "deploy/seed/trailbase-main.db");
  const srcDepot = path.join(REPO_ROOT_GUESS, "mini-services/trailbase-db/traildepot");
  fs.copyFileSync(seedDb, path.join(dataDir, "main.db"));
  fs.cpSync(path.join(srcDepot, "migrations"), path.join(depotDir, "migrations"), { recursive: true });

  let configTxt = fs.readFileSync(path.join(srcDepot, "config.textproto"), "utf8");
  if (opts?.authTokenTtlSec) {
    configTxt = configTxt.replace(
      /auth_token_ttl_sec:\s*\d+/,
      `auth_token_ttl_sec: ${opts.authTokenTtlSec}`,
    );
  }
  fs.writeFileSync(path.join(depotDir, "config.textproto"), configTxt, "utf8");

  const tbPort = await getFreePort();
  const proxy = await createFaultProxy(tbPort);
  const tePort = await getFreePort();
  const internalSecret = opts?.internalSecret ?? "int-test-secret-v1";

  const tbProc = spawn(
    trailBin,
    ["--depot", depotDir, "run", "--address", `127.0.0.1:${tbPort}`, "--dev"],
    {
      cwd: tmpDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const tbUrl = `http://127.0.0.1:${tbPort}`;
  await waitForHttp(`${tbUrl}/api/auth/v1/status`);

  const teProc = spawn(BUN_BIN, ["index.ts"], {
    cwd: ENGINE_DIR,
    env: {
      ...process.env,
      PORT: String(tePort),
      TRAILBASE_URL: `http://127.0.0.1:${proxy.port}`,
      TRAILBASE_DATA_DIR: dataDir,
      TRAILBASE_REQUIRE_SESSION_DB: "1",
      TRADE_AUTH_CACHE_TTL_MS: String(opts?.cacheTtlMs ?? 5000),
      TRADE_SKIP_BOOT_REVIVE: "1",
      TGS_INTERNAL_SECRET: internalSecret,
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "Tengasell#2025",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const teUrl = `http://127.0.0.1:${tePort}`;
  await waitForHttp(`${teUrl}/`);
  // Allow boot admin login to settle cleanly
  await delay(150);

  return {
    tmpDir,
    depotDir,
    dataDir,
    tbPort,
    tbUrl,
    proxyPort: proxy.port,
    proxyState: proxy.state,
    tePort,
    teUrl,
    tbProc,
    teProc,
    closeProxy: proxy.close,
    cleanup: async () => {
      await stopChild(teProc);
      await proxy.close();
      await stopChild(tbProc);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("trade-engine live TrailBase + proxy + Socket.IO integration tests", () => {
  let stack: IsolatedStack;
  let adminToken = "";
  let nyashaToken = "";
  let rufaroToken = "";
  let takudzwaToken = "";
  let nyashaSub = "";
  let testAuctionId = 0;
  let snipeAuctionId = 0;
  const openSockets: ClientSocket[] = [];
  const internalSecret = "int-test-secret-v1";
  const password = process.env.TEST_USER_PASSWORD ?? "Tengasell#2025";

  beforeAll(async () => {
    stack = await bootIsolatedStack({ cacheTtlMs: 5000, internalSecret });

    const [adminL, nyashaL, rufaroL, takudzwaL] = await Promise.all([
      loginTrailBase(stack.tbUrl, "admin", password),
      loginTrailBase(stack.tbUrl, "nyasha", password),
      loginTrailBase(stack.tbUrl, "rufaro", password),
      loginTrailBase(stack.tbUrl, "takudzwa", password),
    ]);
    adminToken = adminL.auth_token;
    nyashaToken = nyashaL.auth_token;
    rufaroToken = rufaroL.auth_token;
    takudzwaToken = takudzwaL.auth_token;
    nyashaSub = decodeClaims(nyashaToken).sub;
    const takudzwaSub = decodeClaims(takudzwaToken).sub;

    const createAuction = async (title: string, endsOffsetMs: number): Promise<number> => {
      const nowIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const endsIso = new Date(Date.now() + endsOffsetMs).toISOString().replace(/\.\d+Z$/, "Z");
      const res = await fetch(`${stack.tbUrl}/api/records/v1/auctions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          user: takudzwaSub,
          seller_username: "takudzwa",
          title,
          slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
          description: "Isolated integration test auction",
          category: "Electronics",
          condition: "mint",
          city: "Harare",
          start_price: 25,
          current_price: 25,
          bid_count: 0,
          status: "live",
          starts_at: nowIso,
          started_at: nowIso,
          ends_at: endsIso,
          created_at: nowIso,
          updated_at: nowIso,
        }),
      });
      if (!res.ok) throw new Error(`Seed auction failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as { ids: number[] };
      return Number(data.ids[0]);
    };

    testAuctionId = await createAuction("Security Integration Lot 1", 3600_000);
    snipeAuctionId = await createAuction("Anti-Snipe Fault Lot 2", 120_000);
  }, 30_000);

  afterAll(async () => {
    for (const s of openSockets) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
    if (stack) await stack.cleanup();
  });

  test("A. unauthenticated and forged-JWT sockets cannot place bids, submit offers, or send messages", async () => {
    // 1. Completely anonymous socket
    const anon = await connectSocket(stack.teUrl);
    openSockets.push(anon.socket);
    expect(anon.hello).toEqual({ ok: true, identity: null });

    const anonBid = await emitRpc(anon.socket, "bid:place", { auctionId: testAuctionId, maxAmount: 30 });
    expect(anonBid).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "AUTH_REQUIRED",
    });

    // 2. Forged alg:none + forged EdDSA-header JWT carrying real user's sub
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const forgedNone = forgeUnsignedJwt({ sub: nyashaSub, username: "nyasha", admin: true, exp }, "none", "forged");
    const forgedEd = forgeUnsignedJwt({ sub: nyashaSub, username: "nyasha", admin: true, exp }, "EdDSA", "forged-signature");

    for (const badToken of [forgedNone, forgedEd]) {
      const attacker = await connectSocket(stack.teUrl, badToken);
      openSockets.push(attacker.socket);
      expect(attacker.hello).toEqual({ ok: true, identity: null });

      const bidAck = await emitRpc(attacker.socket, "bid:place", { auctionId: testAuctionId, maxAmount: 40 });
      expect(bidAck).toMatchObject({ ok: false, committed: false, stage: "pre_commit", code: "AUTH_INVALID" });

      const offerAck = await emitRpc(attacker.socket, "offer:submit", { auctionId: testAuctionId, amount: 40 });
      expect(offerAck).toMatchObject({ ok: false, code: "AUTH_INVALID" });

      const msgAck = await emitRpc(attacker.socket, "message:send", {
        toUsername: "takudzwa",
        body: "forged attempt",
      });
      expect(msgAck).toMatchObject({ ok: false, code: "AUTH_INVALID" });
    }

    // Confirm SQLite bids table still has 0 rows for testAuctionId
    const db = new Database(path.join(stack.dataDir, "main.db"), { readonly: true });
    const count = db.query("SELECT COUNT(*) AS c FROM bids WHERE auction_id = ?").get(testAuctionId) as { c: number };
    db.close();
    expect(count.c).toBe(0);
  });

  test("B. /admin/* and /internal/auth/revoke require admin Bearer or internal secret", async () => {
    const anonStatus = await fetch(`${stack.teUrl}/admin/status`);
    expect(anonStatus.status).toBe(401);

    const anonEnsure = await fetch(`${stack.teUrl}/admin/ensure-dev`, { method: "POST" });
    expect(anonEnsure.status).toBe(401);

    const nonAdminStatus = await fetch(`${stack.teUrl}/admin/status`, {
      headers: { Authorization: `Bearer ${nyashaToken}` },
    });
    expect(nonAdminStatus.status).toBe(403);

    const nonAdminRevoke = await fetch(`${stack.teUrl}/internal/auth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nyashaToken}`,
      },
      body: JSON.stringify({ username: "nyasha" }),
    });
    expect(nonAdminRevoke.status).toBe(403);

    const adminStatus = await fetch(`${stack.teUrl}/admin/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminStatus.status).toBe(200);
  });

  test("C. TrailBase GET logout invalidates ALREADY-OPEN socket and blocks pre-relogin tokens", async () => {
    const victimLogin = await loginTrailBase(stack.tbUrl, "rufaro", password);
    const openConn = await connectSocket(stack.teUrl, victimLogin.auth_token);
    openSockets.push(openConn.socket);
    expect(openConn.hello).toEqual({ ok: true, identity: { username: "rufaro" } });

    const revokedEvents: any[] = [];
    openConn.socket.on("auth:revoked", (e) => revokedEvents.push(e));

    // Real TrailBase GET /api/auth/v1/logout deletes rows in session.db._session
    const logoutRes = await fetch(`${stack.tbUrl}/api/auth/v1/logout`, {
      headers: { Authorization: `Bearer ${victimLogin.auth_token}` },
    });
    expect(logoutRes.status).toBe(200);

    // Same already-connected socket attempts a bid after logout
    const afterLogoutBid = await emitRpc(openConn.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 30,
    });
    expect(afterLogoutBid).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      code: "AUTH_REVOKED",
    });

    await delay(80);
    expect(revokedEvents.length).toBeGreaterThanOrEqual(1);
    expect(openConn.socket.connected).toBe(false);

    // Re-login creates a newer _session row; old pre-logout token MUST remain rejected
    const relogin = await loginTrailBase(stack.tbUrl, "rufaro", password);
    expect(relogin.auth_token).not.toBe(victimLogin.auth_token);

    const oldTokenConn = await connectSocket(stack.teUrl, victimLogin.auth_token);
    openSockets.push(oldTokenConn.socket);
    expect(oldTokenConn.hello).toEqual({ ok: true, identity: null });
    const oldTokenBid = await emitRpc(oldTokenConn.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 30,
    });
    expect(oldTokenBid).toMatchObject({ ok: false, committed: false, code: "AUTH_REVOKED" });

    // Cleanly update outer rufaroToken for subsequent tests
    rufaroToken = relogin.auth_token;
  });

  test("D. /internal/auth/revoke actively disconnects live open sockets and blocks subsequent bids", async () => {
    const freshLogin = await loginTrailBase(stack.tbUrl, "nyasha", password);
    const liveConn = await connectSocket(stack.teUrl, freshLogin.auth_token);
    openSockets.push(liveConn.socket);
    expect(liveConn.hello).toEqual({ ok: true, identity: { username: "nyasha" } });

    const disconnectPromise = new Promise<void>((resolve) => {
      liveConn.socket.once("disconnect", () => resolve());
    });
    const revokedEvents: any[] = [];
    liveConn.socket.on("auth:revoked", (e) => revokedEvents.push(e));

    const revRes = await fetch(`${stack.teUrl}/internal/auth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tgs-internal": internalSecret,
      },
      body: JSON.stringify({ token: freshLogin.auth_token }),
    });
    expect(revRes.status).toBe(200);
    const revJson = (await revRes.json()) as { ok: boolean; disconnected: number };
    expect(revJson).toMatchObject({ ok: true });
    expect(revJson.disconnected).toBeGreaterThanOrEqual(1);

    await disconnectPromise;
    expect(revokedEvents.length).toBeGreaterThanOrEqual(1);

    // Reconnecting with the revoked token yields null hello and blocked bids
    const retryConn = await connectSocket(stack.teUrl, freshLogin.auth_token);
    openSockets.push(retryConn.socket);
    expect(retryConn.hello).toEqual({ ok: true, identity: null });
    const retryAck = await emitRpc(retryConn.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 30,
    });
    expect(retryAck).toMatchObject({ ok: false, committed: false, code: "AUTH_REVOKED" });
  });

  test("E. Admin demotion in _user enforces 403 immediately even with active session", async () => {
    const db = new Database(path.join(stack.dataDir, "main.db"));
    db.exec("PRAGMA busy_timeout = 3000;");
    db.query("UPDATE _user SET admin = 1 WHERE username = 'rufaro'").run();

    const grantedRes = await fetch(`${stack.teUrl}/admin/status`, {
      headers: { Authorization: `Bearer ${rufaroToken}` },
    });
    expect(grantedRes.status).toBe(200);

    // Demote back to regular user
    db.query("UPDATE _user SET admin = 0 WHERE username = 'rufaro'").run();
    db.close();

    const demotedRes = await fetch(`${stack.teUrl}/admin/status`, {
      headers: { Authorization: `Bearer ${rufaroToken}` },
    });
    expect(demotedRes.status).toBe(403);
  });

  test("F. Fault injection: pre-commit 403 -> rejected; commit transport drop -> uncertain -> idempotent retry reconciles", async () => {
    const freshNyasha = await loginTrailBase(stack.tbUrl, "nyasha", password);
    nyashaToken = freshNyasha.auth_token;
    const client = await connectSocket(stack.teUrl, nyashaToken);
    openSockets.push(client.socket);
    expect(client.hello).toEqual({ ok: true, identity: { username: "nyasha" } });

    // 1. Pre-commit 403 WRITE_REJECTED
    stack.proxyState.createBidFault = "403";
    const rejAck = await emitRpc(client.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 45,
      clientRequestId: "int-rej-1",
    });
    stack.proxyState.createBidFault = "none";
    expect(rejAck).toMatchObject({
      ok: false,
      committed: false,
      stage: "pre_commit",
      rejected: true,
      code: "WRITE_REJECTED",
    });

    // 2. Commit succeeds in TrailBase, then proxy resets socket before HTTP response arrives
    stack.proxyState.createBidFault = "drop_after_forward";
    const uncAck = await emitRpc(client.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 55,
      clientRequestId: "int-drop-1",
    });
    expect(uncAck).toMatchObject({
      ok: false,
      uncertain: true,
      stage: "commit_uncertain",
      reason: "unverified",
      code: "COMMIT_UNCERTAIN",
    });
    expect(uncAck.committed).toBeUndefined();

    // 3. Idempotent retry with same clientRequestId reconciles DB row instead of inserting a 2nd bid
    const reconciled = await emitRpc(client.socket, "bid:place", {
      auctionId: testAuctionId,
      maxAmount: 55,
      clientRequestId: "int-drop-1",
    });
    expect(reconciled).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 25,
      winning: true,
      idempotentReplay: true,
    });

    const db = new Database(path.join(stack.dataDir, "main.db"), { readonly: true });
    const rows = db.query("SELECT id, amount, max_amount, status FROM bids WHERE auction_id = ?").all(testAuctionId);
    db.close();
    expect(rows).toHaveLength(1);
  });

  test("G. Post-commit audit ECONNRESET/500 & antiSnipe ECONNRESET STILL ack ok=true committed=true, and tb() auto-refreshes admin token on 403", async () => {
    const client = await connectSocket(stack.teUrl, rufaroToken);
    openSockets.push(client.socket);

    // 1. Force 403 on first admin lookup + reset both anti-snipe and audit on snipeAuctionId
    stack.proxyState.forceNextAdminCall403 = true;
    stack.proxyState.failAntiSnipeMode = "reset";
    stack.proxyState.failAuditMode = "reset";

    const ack1 = await emitRpc(client.socket, "bid:place", {
      auctionId: snipeAuctionId,
      maxAmount: 50,
      clientRequestId: "snipe-fault-1",
    });
    expect(ack1).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 25,
      winning: true,
    });
    expect(ack1.warnings).toEqual(expect.arrayContaining(["anti_snipe_failed", "audit_failed"]));

    // 2. Audit HTTP 500 on second bid still returns ok:true, committed:true
    stack.proxyState.failAntiSnipeMode = "none";
    stack.proxyState.failAuditMode = "500";
    const client2 = await connectSocket(stack.teUrl, nyashaToken);
    openSockets.push(client2.socket);

    const ack2 = await emitRpc(client2.socket, "bid:place", {
      auctionId: snipeAuctionId,
      maxAmount: 75,
      clientRequestId: "snipe-fault-2",
    });
    stack.proxyState.failAuditMode = "none";
    expect(ack2).toMatchObject({
      ok: true,
      committed: true,
      stage: "committed",
      amount: 51,
      winning: true,
    });
    expect(ack2.warnings).toEqual(expect.arrayContaining(["audit_failed"]));

    const db = new Database(path.join(stack.dataDir, "main.db"), { readonly: true });
    const rows = db
      .query("SELECT bidder_username, amount, status FROM bids WHERE auction_id = ? ORDER BY id")
      .all(snipeAuctionId) as Array<{ bidder_username: string; amount: number; status: string }>;
    db.close();
    expect(rows).toEqual([
      { bidder_username: "rufaro", amount: 25, status: "superseded" },
      { bidder_username: "nyasha", amount: 51, status: "active" },
    ]);
  });

  test("H. Concurrent Socket.IO bids on the same auction serialize cleanly with single active winner", async () => {
    const nyasha = await loginTrailBase(stack.tbUrl, "nyasha", password);
    const rufaro = await loginTrailBase(stack.tbUrl, "rufaro", password);
    const c1 = await connectSocket(stack.teUrl, nyasha.auth_token);
    const c2 = await connectSocket(stack.teUrl, rufaro.auth_token);
    openSockets.push(c1.socket, c2.socket);

    // Seed a third clean auction so concurrent pricing math is deterministic regardless of previous tests
    const nowIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const endsIso = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const takudzwaSub = decodeClaims(takudzwaToken).sub;
    const res = await fetch(`${stack.tbUrl}/api/records/v1/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        user: takudzwaSub,
        seller_username: "takudzwa",
        title: "Concurrent Lock Lot 3",
        slug: `concurrent-lot-${Date.now()}`,
        description: "Concurrency lot",
        category: "Electronics",
        condition: "mint",
        city: "Harare",
        start_price: 20,
        current_price: 20,
        bid_count: 0,
        status: "live",
        starts_at: nowIso,
        started_at: nowIso,
        ends_at: endsIso,
        created_at: nowIso,
        updated_at: nowIso,
      }),
    });
    const concurrentLotId = Number(((await res.json()) as { ids: number[] }).ids[0]);

    const [ackA, ackB] = await Promise.all([
      emitRpc(c1.socket, "bid:place", {
        auctionId: concurrentLotId,
        maxAmount: 60,
        clientRequestId: "conc-a",
      }),
      emitRpc(c2.socket, "bid:place", {
        auctionId: concurrentLotId,
        maxAmount: 85,
        clientRequestId: "conc-b",
      }),
    ]);

    expect(ackA.ok).toBe(true);
    expect(ackA.committed).toBe(true);
    expect(ackB.ok).toBe(true);
    expect(ackB.committed).toBe(true);

    const db = new Database(path.join(stack.dataDir, "main.db"), { readonly: true });
    const bids = db
      .query("SELECT bidder_username, amount, max_amount, status FROM bids WHERE auction_id = ? ORDER BY id")
      .all(concurrentLotId) as Array<{
      bidder_username: string;
      amount: number;
      max_amount: number;
      status: string;
    }>;
    const auction = db
      .query("SELECT current_price, bid_count FROM auctions WHERE id = ?")
      .get(concurrentLotId) as { current_price: number; bid_count: number };
    db.close();

    expect(bids).toHaveLength(2);
    expect(bids.filter((b) => b.status === "active")).toHaveLength(1);
    const active = bids.find((b) => b.status === "active")!;
    expect(active.bidder_username).toBe("rufaro");
    expect(auction.current_price).toBe(active.amount);
    expect(auction.bid_count).toBe(2);
  });

  test("I. Short 2s auth_token_ttl_sec expires active open socket cleanly with AUTH_EXPIRED", async () => {
    const shortStack = await bootIsolatedStack({ authTokenTtlSec: 2, cacheTtlMs: 30_000 });
    let sock: ClientSocket | null = null;
    try {
      const login = await loginTrailBase(shortStack.tbUrl, "nyasha", password);
      const admin = await loginTrailBase(shortStack.tbUrl, "admin", password);
      const takudzwa = await loginTrailBase(shortStack.tbUrl, "takudzwa", password);
      const nowIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const endsIso = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
      const seedRes = await fetch(`${shortStack.tbUrl}/api/records/v1/auctions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${admin.auth_token}`,
        },
        body: JSON.stringify({
          user: decodeClaims(takudzwa.auth_token).sub,
          seller_username: "takudzwa",
          title: "Short TTL Lot",
          slug: `short-ttl-lot-${Date.now()}`,
          description: "Short TTL test",
          category: "Electronics",
          condition: "mint",
          city: "Harare",
          start_price: 15,
          current_price: 15,
          bid_count: 0,
          status: "live",
          starts_at: nowIso,
          started_at: nowIso,
          ends_at: endsIso,
          created_at: nowIso,
          updated_at: nowIso,
        }),
      });
      const lotId = Number(((await seedRes.json()) as { ids: number[] }).ids[0]);

      const conn = await connectSocket(shortStack.teUrl, login.auth_token);
      sock = conn.socket;
      expect(conn.hello).toEqual({ ok: true, identity: { username: "nyasha" } });

      const firstBid = await emitRpc(sock, "bid:place", { auctionId: lotId, maxAmount: 20 });
      expect(firstBid).toMatchObject({ ok: true, committed: true, stage: "committed" });

      // Wait until the 2-second token expires naturally
      await delay(2600);

      const expiredBid = await emitRpc(sock, "bid:place", { auctionId: lotId, maxAmount: 25 });
      expect(expiredBid).toMatchObject({
        ok: false,
        committed: false,
        stage: "pre_commit",
        code: "AUTH_EXPIRED",
      });

      await delay(80);
      expect(sock.connected).toBe(false);
    } finally {
      try {
        sock?.close();
      } catch {
        /* ignore */
      }
      await shortStack.cleanup();
    }
  }, 30_000);
});
