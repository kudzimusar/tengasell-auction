#!/usr/bin/env node
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { io } from "socket.io-client";

const ROOT = process.cwd();
const TRAIL_BIN = path.join(ROOT, ".tools/tb/trail");
const TEMPLATE_DEPOT = path.join(ROOT, "mini-services/trailbase-db/traildepot");
const STANDALONE_SERVER = path.join(ROOT, ".next/standalone/server.js");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Tengasell#2025";
const USER_PASSWORD = "TestUser#2025";

const LOCAL_UAT_DIR = path.join(ROOT, ".artifacts/pi-uat/pi-01e");
const ARTIFACT_SCREENSHOT_DIR = process.env.ARTIFACT_DIR
  ? path.join(process.env.ARTIFACT_DIR, "pi-01e")
  : LOCAL_UAT_DIR;

const SENSITIVE_IDENTIFIERS = [
  "JTEBU29J105991111",
  "AFAPXXMJ2PK992222",
  "JMZBM54Z101993333",
  "JTEBR3FJ90K123456",
  "UAT-1111",
  "UAT-2222",
  "UAT-3333",
  "CHAS-UAT-1111",
  "CHAS-UAT-2222",
  "CHAS-UAT-3333",
  "ENG-UAT-1111",
  "ENG-UAT-2222",
  "ENG-UAT-3333",
  "OWN-UAT-111",
  "REG-UAT-111",
  "OWN-UAT-999",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Could not allocate port")));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttp(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "not started";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status > 0 && res.status < 500) return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastErr}`);
}

async function waitUntil(label, fn, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function decodeSub(token) {
  const part = token.split(".")[1] || "";
  const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return String(payload.sub || "");
}

async function tbJson(tbUrl, method, apiPath, token = null, body = undefined) {
  const res = await fetch(`${tbUrl}${apiPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function ensureUserAndProfile(tbUrl, teUrl, socketsToClose, username, isAdmin = false) {
  if (!isAdmin) {
    await tbJson(tbUrl, "POST", "/api/auth/v1/register", null, {
      username,
      password: USER_PASSWORD,
      password_repeat: USER_PASSWORD,
    });
  }
  const login = await tbJson(tbUrl, "POST", "/api/auth/v1/login", null, {
    username: isAdmin ? ADMIN_USERNAME : username,
    password: isAdmin ? ADMIN_PASSWORD : USER_PASSWORD,
  });
  assert.ok(login.status < 400 && login.json?.auth_token, `Login failed for ${username}: ${login.status} ${login.text}`);
  const token = String(login.json.auth_token);
  const userId = decodeSub(token);

  const profCheck = await tbJson(
    tbUrl,
    "GET",
    `/api/records/v1/profiles?filter[username][$eq]=${encodeURIComponent(username)}&limit=1`,
    token,
  );
  if (!profCheck.json?.records?.length) {
    await tbJson(tbUrl, "POST", "/api/records/v1/profiles", token, {
      user: userId,
      username,
      display_name: username,
      bio: "",
      city: "Harare",
      verified: isAdmin ? 1 : 0,
      joined_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }

  const socket = await new Promise((resolve, reject) => {
    const s = io(teUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });
    const timer = setTimeout(() => {
      s.close();
      reject(new Error(`Socket timeout for ${username}`));
    }, 10000);
    s.on("connect", () => {
      clearTimeout(timer);
      socketsToClose.push(s);
      resolve(s);
    });
    s.on("connect_error", (err) => {
      clearTimeout(timer);
      s.close();
      reject(err);
    });
  });

  return { username, userId, token, socket };
}

async function rpc(socket, event, payload) {
  return await new Promise((resolve, reject) => {
    socket.timeout(12000).emit(event, payload, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function startGatewayProxy(tbPort, tePort, nextPort, gwPort) {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${gwPort}`);
    const xPort = reqUrl.searchParams.get("XTransformPort");
    if (xPort === "3004" && reqUrl.pathname === "/styles/tengasell.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: 8, sources: {}, layers: [] }));
      return;
    }
    let targetPort = nextPort;
    if (
      xPort === "3001" ||
      reqUrl.pathname.startsWith("/api/records/") ||
      reqUrl.pathname.startsWith("/api/auth/v1/")
    ) {
      targetPort = tbPort;
    } else if (xPort === "3002" || reqUrl.pathname.startsWith("/socket.io/")) {
      targetPort = tePort;
    }

    if (targetPort !== nextPort) {
      reqUrl.searchParams.delete("XTransformPort");
    }

    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: `${reqUrl.pathname}${reqUrl.search}`,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
      }
      res.end(`Gateway proxy error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  server.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(tePort, "127.0.0.1", () => {
      const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${gwPort}`);
      reqUrl.searchParams.delete("XTransformPort");
      const reqLine = `${req.method} ${reqUrl.pathname}${reqUrl.search} HTTP/${req.httpVersion}\r\n`;
      let rawHeaders = "";
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const v = req.rawHeaders[i + 1];
        if (k.toLowerCase() === "host") {
          rawHeaders += `${k}: 127.0.0.1:${tePort}\r\n`;
        } else {
          rawHeaders += `${k}: ${v}\r\n`;
        }
      }
      upstream.write(reqLine + rawHeaders + "\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(gwPort, "127.0.0.1", () => resolve(server));
  });
}

async function seedLiveVehicle({
  seller,
  inspector,
  reviewer,
  categoryKey,
  title,
  description,
  startPrice,
  buyNowPrice,
  vehicle,
  sellerOdo,
  inspectorOdo,
  includeDocs = true,
}) {
  const openRes = await rpc(seller.socket, "product:intake:open", {
    intake: {
      commandId: `uat-open-${categoryKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      categoryKey,
      title,
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      description,
      condition: "used",
      start_price: startPrice,
      buy_now_price: buyNowPrice,
      reserve_price: startPrice + 1500,
      shipping_fee: 0,
      shipping: "pickup",
      city: "Harare",
      ends_at: "2030-06-01T00:00:00Z",
      images: ["/logo.svg"],
      allow_offers: false,
    },
  });
  assert.ok(openRes?.ok && openRes.auction?.id > 0, `openProductIntake failed for ${title}: ${JSON.stringify(openRes)}`);
  const auctionId = Number(openRes.auction.id);

  const intakeRes = await rpc(seller.socket, "vehicle:intake", {
    auctionId,
    vehicle: {
      ...vehicle,
      odometerKm: sellerOdo,
      locationCity: "Harare",
      ownershipStatus: "DECLARED_OWNER",
      customsStatus: "LOCAL",
      requestedDurationHours: 72,
    },
  });
  assert.ok(intakeRes?.ok && intakeRes.vehicle?.id > 0, `vehicle:intake failed for ${title}: ${JSON.stringify(intakeRes)}`);
  const vehicleId = Number(intakeRes.vehicle.id);

  const pubRes = await rpc(seller.socket, "product:intake:publish", {
    command: {
      commandId: `uat-pub-${auctionId}-${Date.now()}`,
      sessionId: Number(openRes.session.id),
      expectedRevision: Number(openRes.session.revision),
      commandType: "PUBLISH",
    },
  });
  assert.ok(pubRes?.ok && pubRes.session?.state === "PUBLISHED", `product:intake:publish failed for ${title}: ${JSON.stringify(pubRes)}`);

  if (includeDocs) {
    const regDoc = await rpc(seller.socket, "vehicle:document:add", {
      vehicleId,
      document: {
        documentType: "REGISTRATION",
        documentRef: vehicle._regDocRef || `REG-UAT-${vehicleId}`,
        issuer: "CVR Zimbabwe",
        storageRef: `vault://uat/reg-${vehicleId}.pdf`,
        documentNumber: `REGNUM-${vehicleId}`,
        artifactRequired: true,
      },
    });
    assert.ok(regDoc?.ok && regDoc.document?.id > 0, `reg doc add failed: ${JSON.stringify(regDoc)}`);

    const ownDoc = await rpc(seller.socket, "vehicle:document:add", {
      vehicleId,
      document: {
        documentType: "OWNERSHIP",
        documentRef: vehicle._ownDocRef || `OWN-UAT-${vehicleId}`,
        issuer: "ZIMRA",
        storageRef: `vault://uat/own-${vehicleId}.pdf`,
        documentNumber: `OWNNUM-${vehicleId}`,
        artifactRequired: true,
      },
    });
    assert.ok(ownDoc?.ok && ownDoc.document?.id > 0, `own doc add failed: ${JSON.stringify(ownDoc)}`);

    const vReg = await rpc(inspector.socket, "vehicle:document:review", {
      documentId: Number(regDoc.document.id),
      action: "VERIFY",
    });
    assert.ok(vReg?.ok, `reg doc verify failed: ${JSON.stringify(vReg)}`);

    const vOwn = await rpc(inspector.socket, "vehicle:document:review", {
      documentId: Number(ownDoc.document.id),
      action: "VERIFY",
    });
    assert.ok(vOwn?.ok, `own doc verify failed: ${JSON.stringify(vOwn)}`);
  }

  const startInsp = await rpc(inspector.socket, "vehicle:inspection:start", { vehicleId });
  assert.ok(startInsp?.ok && startInsp.inspection?.id > 0, `inspection:start failed: ${JSON.stringify(startInsp)}`);
  const inspectionId = Number(startInsp.inspection.id);

  const subInsp = await rpc(inspector.socket, "vehicle:inspection:submit", {
    inspectionId,
    inspection: {
      roadworthy: true,
      odometerKm: inspectorOdo,
      notes: "Live browser UAT verified inspection.",
    },
  });
  assert.ok(subInsp?.ok, `inspection:submit failed: ${JSON.stringify(subInsp)}`);

  const revInsp = await rpc(reviewer.socket, "vehicle:inspection:review", {
    inspectionId,
    commandId: `uat-rev-${inspectionId}-${Date.now()}`,
  });
  assert.ok(
    revInsp?.ok && revInsp.bundle?.eligibility?.status === "ELIGIBLE",
    `inspection:review failed for ${title}: ${JSON.stringify(revInsp)}`,
  );

  return { auctionId, vehicleId, title };
}

function attachPageMonitors(page, bucket) {
  page.on("pageerror", (err) => {
    bucket.pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text();
      const locUrl = msg.location()?.url || "";
      // Ignore third-party external CDN image DNS errors in air-gapped CI/sandbox if any;
      // fail hard on any local 127.0.0.1 error, JS error, or API error.
      if (!txt.includes("z-cdn.chatglm.cn") && !locUrl.includes("z-cdn.chatglm.cn")) {
        bucket.consoleErrors.push(locUrl ? `${txt} [${locUrl}]` : txt);
      }
    }
  });
  page.on("response", async (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && url.startsWith("http://127.0.0.1")) {
      console.log(`[HTTP ${status}] ${res.request().method()} ${url}`);
    }
    if (status >= 500 && url.startsWith("http://127.0.0.1")) {
      bucket.server5xx.push(`${status} ${url}`);
    }
    if (
      bucket.checkBuyerPrivacy &&
      url.startsWith("http://127.0.0.1") &&
      (url.includes("/api/pi/") || url.includes("/api/records/"))
    ) {
      const body = await res.text().catch(() => "");
      for (const secret of SENSITIVE_IDENTIFIERS) {
        if (body.includes(secret)) {
          bucket.privacyLeaks.push(`Network response ${url} leaked ${secret}`);
        }
      }
    }
  });
}

async function saveShot(page, name, manifestEntries = null) {
  fs.mkdirSync(LOCAL_UAT_DIR, { recursive: true });
  const localPath = path.join(LOCAL_UAT_DIR, name);
  await page.screenshot({ path: localPath, fullPage: false });
  if (ARTIFACT_SCREENSHOT_DIR !== LOCAL_UAT_DIR) {
    try {
      fs.mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });
      fs.copyFileSync(localPath, path.join(ARTIFACT_SCREENSHOT_DIR, name));
    } catch {
      /* ignore external artifact copy failures in CI environments */
    }
  }
  const buf = fs.readFileSync(localPath);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  if (manifestEntries) {
    manifestEntries.push({
      file: name,
      bytes: buf.length,
      sha256: hash,
    });
  }
}

async function main() {
  assert.ok(fs.existsSync(TRAIL_BIN), `Missing TrailBase binary at ${TRAIL_BIN}`);
  assert.ok(fs.existsSync(STANDALONE_SERVER), `Missing standalone server at ${STANDALONE_SERVER}; run npm run build first`);

  const manifestEntries = [];

  if (fs.existsSync(path.join(ROOT, ".next/static"))) {
    fs.cpSync(path.join(ROOT, ".next/static"), path.join(ROOT, ".next/standalone/.next/static"), { recursive: true });
  }
  if (fs.existsSync(path.join(ROOT, "public"))) {
    fs.cpSync(path.join(ROOT, "public"), path.join(ROOT, ".next/standalone/public"), { recursive: true });
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-pi-uat-"));
  const depotDir = path.join(tmpRoot, "traildepot");
  const dataDir = path.join(depotDir, "data");
  fs.cpSync(TEMPLATE_DEPOT, depotDir, { recursive: true });

  const tbPort = await getFreePort();
  const tePort = await getFreePort();
  const nextPort = await getFreePort();
  const gwPort = await getFreePort();

  const tbUrl = `http://127.0.0.1:${tbPort}`;
  const teUrl = `http://127.0.0.1:${tePort}`;
  const nextUrl = `http://127.0.0.1:${nextPort}`;
  const gwUrl = `http://127.0.0.1:${gwPort}`;

  let tbProc = null;
  let teProc = null;
  let nextProc = null;
  let gwServer = null;
  let browser = null;
  const socketsToClose = [];
  const logs = { tb: [], te: [], next: [] };

  try {
    tbProc = spawn(TRAIL_BIN, ["--depot", depotDir, "run", "--address", `127.0.0.1:${tbPort}`, "--dev"], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    tbProc.stdout?.on("data", (d) => logs.tb.push(d.toString()));
    tbProc.stderr?.on("data", (d) => logs.tb.push(d.toString()));
    await waitForHttp(`${tbUrl}/api/records/v1/categories?limit=1`);

    // Keep seeded catalog auctions (dated Oct 2026 in seed SQL) live relative to current wall-clock in temp UAT DB
    const tbAdminLogin = await tbJson(tbUrl, "POST", "/api/auth/v1/login", null, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    assert.ok(tbAdminLogin.status < 400 && tbAdminLogin.json?.auth_token, "Pre-TE admin login failed");
    const preTeAdminToken = String(tbAdminLogin.json.auth_token);
    const futureEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const seededLive = await tbJson(tbUrl, "GET", "/api/records/v1/auctions?filter[status][$eq]=live&limit=50", preTeAdminToken);
    for (const row of seededLive.json?.records ?? []) {
      await tbJson(tbUrl, "PATCH", `/api/records/v1/auctions/${row.id}`, preTeAdminToken, { ends_at: futureEndsAt });
    }

    teProc = spawn("bun", ["run", "mini-services/trade-engine/index.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(tePort),
        TRAILBASE_URL: tbUrl,
        TRAILBASE_INTERNAL_URL: tbUrl,
        TRAILBASE_DATA_DIR: dataDir,
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    teProc.stdout?.on("data", (d) => logs.te.push(d.toString()));
    teProc.stderr?.on("data", (d) => logs.te.push(d.toString()));
    await waitForHttp(`${teUrl}/`);

    nextProc = spawn("node", [STANDALONE_SERVER], {
      cwd: path.join(ROOT, ".next/standalone"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(nextPort),
        HOSTNAME: "127.0.0.1",
        TRAILBASE_URL: tbUrl,
        TRAILBASE_INTERNAL_URL: tbUrl,
        TRADE_ENGINE_URL: teUrl,
        TRAILBASE_DATA_DIR: dataDir,
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    nextProc.stdout?.on("data", (d) => logs.next.push(d.toString()));
    nextProc.stderr?.on("data", (d) => logs.next.push(d.toString()));
    await waitForHttp(`${nextUrl}/`);

    gwServer = await startGatewayProxy(tbPort, tePort, nextPort, gwPort);

    const admin = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, ADMIN_USERNAME, true);
    const sellera1 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "sellera1");
    const buyeruat1 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "buyeruat1");
    const inspector3 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "inspector3");
    const reviewerd4 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "reviewerd4");

    await waitUntil("trade-engine admin session ready", async () => {
      const r = await rpc(admin.socket, "product:search:rebuild", {});
      return r?.ok === true;
    });

    const g1 = await rpc(admin.socket, "vehicle:role:grant", {
      user: inspector3.userId,
      username: inspector3.username,
      role: "INSPECTOR",
    });
    assert.ok(g1?.ok, `Grant INSPECTOR failed: ${JSON.stringify(g1)}`);
    const g2 = await rpc(admin.socket, "vehicle:role:grant", {
      user: reviewerd4.userId,
      username: reviewerd4.username,
      role: "REVIEWER",
    });
    assert.ok(g2?.ok, `Grant REVIEWER failed: ${JSON.stringify(g2)}`);

    // Seed Vehicle 1 (Pickup, CONFLICTED odometer: seller=55000, inspector=58000)
    await seedLiveVehicle({
      seller: sellera1,
      inspector: inspector3,
      reviewer: reviewerd4,
      categoryKey: "VEHICLE_PICKUP",
      title: "2021 Toyota Hilux 2.8 GD-6 4x4 UAT",
      description: "Live UAT seeded Toyota Hilux Double Cab 4x4 with conflicted odometer declaration.",
      startPrice: 32000,
      buyNowPrice: 39000,
      sellerOdo: 55000,
      inspectorOdo: 58000,
      vehicle: {
        vin: "JTEBU29J105991111",
        chassisNumber: "CHAS-UAT-1111",
        registrationNumber: "UAT-1111",
        engineNumber: "ENG-UAT-1111",
        _regDocRef: "REG-UAT-111",
        _ownDocRef: "OWN-UAT-111",
        make: "Toyota",
        model: "Hilux",
        variant: "2.8 GD-6",
        modelYear: 2021,
        manufactureYear: 2021,
        engineDisplacementCc: 2755,
        fuelType: "DIESEL",
        transmission: "AUTOMATIC",
        drivetrain: "4WD",
        vehicleClass: "PICKUP",
        bodyType: "PICKUP_DOUBLE_CAB",
        steeringSide: "RIGHT",
        cabType: "DOUBLE",
        doors: 4,
        seats: 5,
        primaryExteriorColour: "WHITE",
        serviceHistoryClass: "FULL_MANUFACTURER",
        accidentHistory: "NONE_DECLARED",
        spareKey: true,
        spareWheel: true,
      },
    });

    // Seed Vehicle 2 (Pickup, UNKNOWN fields like doors/keys left null)
    await seedLiveVehicle({
      seller: sellera1,
      inspector: inspector3,
      reviewer: reviewerd4,
      categoryKey: "VEHICLE_PICKUP",
      title: "2020 Ford Ranger Wildtrak 3.2 UAT",
      description: "Live UAT seeded Ford Ranger Double Cab with omitted optional specs for UNKNOWN comparison state.",
      startPrice: 27500,
      buyNowPrice: 34000,
      sellerOdo: 72000,
      inspectorOdo: 72000,
      vehicle: {
        vin: "AFAPXXMJ2PK992222",
        chassisNumber: "CHAS-UAT-2222",
        registrationNumber: "UAT-2222",
        engineNumber: "ENG-UAT-2222",
        make: "Ford",
        model: "Ranger",
        variant: "Wildtrak",
        modelYear: 2020,
        fuelType: "DIESEL",
        transmission: "AUTOMATIC",
        drivetrain: "4WD",
        vehicleClass: "PICKUP",
        bodyType: "PICKUP_DOUBLE_CAB",
        steeringSide: "RIGHT",
        cabType: "DOUBLE",
        doors: null,
        seats: null,
        numberOfKeys: null,
        primaryExteriorColour: "GREY",
        serviceHistoryClass: "PARTIAL",
        accidentHistory: "NONE_DECLARED",
      },
    });

    // Seed Vehicle 3 (Passenger Car -> exercises CAB_TYPE = NOT_APPLICABLE when compared with Pickups)
    await seedLiveVehicle({
      seller: sellera1,
      inspector: inspector3,
      reviewer: reviewerd4,
      categoryKey: "VEHICLE_PASSENGER_CAR",
      title: "2019 Mazda Axela Skyactiv UAT",
      description: "Live UAT seeded Passenger Car used to verify cross-leaf NOT_APPLICABLE comparison state.",
      startPrice: 12000,
      buyNowPrice: 15500,
      sellerOdo: 61000,
      inspectorOdo: 61000,
      vehicle: {
        vin: "JMZBM54Z101993333",
        chassisNumber: "CHAS-UAT-3333",
        registrationNumber: "UAT-3333",
        engineNumber: "ENG-UAT-3333",
        make: "Mazda",
        model: "Axela",
        variant: "1.5 Skyactiv",
        modelYear: 2019,
        fuelType: "PETROL",
        transmission: "AUTOMATIC",
        drivetrain: "FWD",
        vehicleClass: "PASSENGER_CAR",
        bodyType: "SEDAN",
        steeringSide: "RIGHT",
        doors: 4,
        seats: 5,
        primaryExteriorColour: "BLUE",
        serviceHistoryClass: "FULL_INDEPENDENT",
        accidentHistory: "NONE_DECLARED",
      },
    });

    const rebuildRes = await rpc(admin.socket, "product:search:rebuild", {});
    assert.ok(rebuildRes?.ok, `product:search:rebuild failed: ${JSON.stringify(rebuildRes)}`);

    browser = await chromium.launch({ headless: true });

    // ────────────────────────────────────────────────────────────────
    // FLOW 1: Seller Disclosure Wizard (#/sell/new)
    // ────────────────────────────────────────────────────────────────
    const sellerMonitors = { consoleErrors: [], pageErrors: [], server5xx: [], privacyLeaks: [], checkBuyerPrivacy: false };
    const sellerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await sellerCtx.addInitScript(({ token, username }) => {
      localStorage.setItem("ts_auth", JSON.stringify({ token, username }));
    }, { token: sellera1.token, username: sellera1.username });
    const sellerPage = await sellerCtx.newPage();
    attachPageMonitors(sellerPage, sellerMonitors);

    await sellerPage.goto(`${gwUrl}/#/sell/new`, { waitUntil: "networkidle" });
    await sellerPage.getByText("Live engine").first().waitFor({ state: "visible", timeout: 15000 });
    await sellerPage.getByRole("heading", { name: /Photos & basics/i }).waitFor({ state: "visible", timeout: 10000 });

    // Pick first stock photo
    await sellerPage.locator('button[aria-label="Add stock photo 1"]').click();
    await sellerPage.locator("#title").fill("2022 Toyota Land Cruiser Prado VX-L UAT");

    // Category = Vehicles
    await sellerPage.locator("#category").click();
    await sellerPage.getByRole("option", { name: /Vehicles/i }).click();

    // Condition = Used
    await sellerPage.locator("#condition").click();
    await sellerPage.getByRole("option", { name: "Used — good", exact: true }).click();

    // Verify Vehicle Authority & Governed Schema sections appear dynamically
    await sellerPage.locator("#vehicle-intake-heading").waitFor({ state: "visible", timeout: 10000 });
    await sellerPage.getByText(/publish-required facts/i).waitFor({ state: "visible", timeout: 10000 });

    await sellerPage.locator("#vehicle-vin").fill("JTEBR3FJ90K123456");
    await sellerPage.locator("#vehicle-year").fill("2022");
    await sellerPage.locator("#vehicle-make").fill("Toyota");
    await sellerPage.locator("#vehicle-model").fill("Prado");
    await sellerPage.locator("#vehicle-odometer").fill("34000");
    await sellerPage.locator("#vehicle-owner-doc").fill("OWN-UAT-999");
    await sellerPage.locator("#vehicle-intake-heading").scrollIntoViewIfNeeded();
    await sleep(150);
    await saveShot(sellerPage, "01-seller-wizard.png", manifestEntries);

    await sellerPage.locator("#description").fill(
      "One-owner Toyota Land Cruiser Prado VX-L maintained at official dealer with complete service records.",
    );

    await sellerPage.locator("#city").click();
    await sellerPage.getByRole("option", { name: "Harare", exact: true }).click();

    // Step 2: Pricing & shipping
    await sellerPage.getByRole("button", { name: "Next" }).click();
    await sellerPage.locator("#step2-heading").waitFor({ state: "visible", timeout: 10000 });
    await sellerPage.locator("#start-price").fill("45000");

    // Step 3: Review & list
    await sellerPage.getByRole("button", { name: "Next" }).click();
    await sellerPage.locator("#sla-ack").waitFor({ state: "visible", timeout: 10000 });
    await sellerPage.locator("#sla-ack").click();

    await sellerPage.getByRole("button", { name: /List your item/i }).click();
    await sellerPage.getByLabel("Listing created successfully").waitFor({ state: "visible", timeout: 20000 });
    await sellerPage.getByText(/Vehicle submitted for inspection/i).waitFor({ state: "visible", timeout: 10000 });

    assert.equal(sellerMonitors.consoleErrors.length, 0, `Seller console errors: ${sellerMonitors.consoleErrors.join("; ")}`);
    assert.equal(sellerMonitors.pageErrors.length, 0, `Seller page errors: ${sellerMonitors.pageErrors.join("; ")}`);
    assert.equal(sellerMonitors.server5xx.length, 0, `Seller 5xx: ${sellerMonitors.server5xx.join("; ")}`);
    await sellerCtx.close();
    console.log("UAT Flow 1 (Seller Disclosure Wizard & Draft Inspection Gate): PASS");

    // ────────────────────────────────────────────────────────────────
    // FLOWS 2–5: Buyer Discovery, Comparison, Saved Searches & Viewports
    // ────────────────────────────────────────────────────────────────
    const buyerMonitors = { consoleErrors: [], pageErrors: [], server5xx: [], privacyLeaks: [], checkBuyerPrivacy: true };
    const buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await buyerCtx.addInitScript(({ token, username }) => {
      localStorage.setItem("ts_auth", JSON.stringify({ token, username }));
    }, { token: buyeruat1.token, username: buyeruat1.username });
    const page = await buyerCtx.newPage();
    attachPageMonitors(page, buyerMonitors);

    // Flow 2: Vehicle structured browse & filtering
    await page.goto(`${gwUrl}/#/c/vehicles`, { waitUntil: "networkidle" });
    await page.getByText("Live engine").first().waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("2020 Ford Ranger Wildtrak 3.2 UAT").waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("2019 Mazda Axela Skyactiv UAT").waitFor({ state: "visible", timeout: 15000 });

    // Assert seller's unapproved draft Prado is NOT visible to buyer
    const pradoCount = await page.getByText("2022 Toyota Land Cruiser Prado VX-L UAT").count();
    assert.equal(pradoCount, 0, "Unapproved whole vehicle draft Prado leaked onto public vehicle browse!");

    // Verify Vehicle filter sections visible
    for (const label of ["Make", "Model", "Year Range", "Mileage (km)", "Body Type"]) {
      await page.locator("aside legend", { hasText: label }).first().waitFor({ state: "visible", timeout: 5000 });
    }

    // Filter live by Make = Toyota via FilterPanel
    await page.locator('aside button[aria-label="Make filter"]').click();
    await page.getByRole("option", { name: "Toyota", exact: true }).click();

    await waitUntil("live Make=Toyota filter hides Ford Ranger", async () => {
      const rangerVisible = await page.getByText("2020 Ford Ranger Wildtrak 3.2 UAT").count();
      const hiluxVisible = await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").count();
      return hiluxVisible === 1 && rangerVisible === 0;
    }, 15000);

    // Clear filters back to full vehicles list
    await page.getByRole("button", { name: /Clear all/i }).first().click();
    await page.getByText("2020 Ford Ranger Wildtrak 3.2 UAT").waitFor({ state: "visible", timeout: 15000 });

    // Switch to Smartphones / Phones category and verify ZERO vehicle filter bleed
    await page.goto(`${gwUrl}/#/c/phones`, { waitUntil: "networkidle" });
    await page.getByText(/Apple iPhone 13|Samsung Galaxy S23/i).first().waitFor({ state: "visible", timeout: 15000 });
    await waitUntil("Smartphone dynamic schema filters load without vehicle bleed", async () => {
      const asideText = await page.locator("aside").innerText();
      return asideText.includes("Brand") && asideText.includes("Storage") && !asideText.includes("Mileage (km)") && !asideText.includes("Drivetrain");
    }, 15000);
    await saveShot(page, "02-category-filters-phones.png", manifestEntries);
    console.log("UAT Flow 2 (Live Structured Filtering & Zero Category Filter Bleed): PASS");

    // Flow 3: Multi-Listing Comparison Modal (KNOWN, UNKNOWN, CONFLICTED, REDACTED, NOT_APPLICABLE)
    await page.goto(`${gwUrl}/#/c/vehicles`, { waitUntil: "networkidle" });
    await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").waitFor({ state: "visible", timeout: 15000 });

    const compareButtons = page.locator("button", { hasText: /^\+ Compare$/ });
    assert.ok((await compareButtons.count()) >= 3, "Expected at least 3 vehicles with + Compare buttons");

    // Select Hilux, Ranger, and Mazda Axela (3 items across related vehicle leaves)
    const hiluxCard = page.locator("div.group", { hasText: "2021 Toyota Hilux 2.8 GD-6 4x4 UAT" }).first();
    const rangerCard = page.locator("div.group", { hasText: "2020 Ford Ranger Wildtrak 3.2 UAT" }).first();
    const mazdaCard = page.locator("div.group", { hasText: "2019 Mazda Axela Skyactiv UAT" }).first();

    await hiluxCard.locator("button", { hasText: "Compare" }).click();
    await rangerCard.locator("button", { hasText: "Compare" }).click();
    await mazdaCard.locator("button", { hasText: "Compare" }).click();

    await page.getByText("Compare (3/3)").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: "Compare Now" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByText("Product Comparison").waitFor({ state: "visible", timeout: 15000 });
    await dialog.getByText("Shared Family Attributes").waitFor({ state: "visible", timeout: 10000 });

    // Assert all 5 epistemic states appear truthfully in the rendered comparison matrix
    await dialog.getByText("Toyota", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }); // KNOWN
    await dialog.getByText("Unknown", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }); // UNKNOWN
    await dialog.getByText("Conflicted", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }); // CONFLICTED
    await dialog.getByText("Redacted", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }); // REDACTED
    await dialog.getByText("N/A", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 }); // NOT_APPLICABLE

    const fullHtml = await page.content();
    for (const secret of SENSITIVE_IDENTIFIERS) {
      assert.ok(!fullHtml.includes(secret), `DOM leaked private identifier ${secret} inside comparison modal!`);
    }

    await sleep(300);
    await saveShot(page, "03-comparison-modal.png", manifestEntries);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    console.log("UAT Flow 3 (Product Comparison Modal — All 5 States & Zero Privacy Leaks): PASS");

    // Flow 4: Saved Searches Persistence, Page Reload & Deep Link
    await page.locator('aside input[aria-label="Model filter"]').fill("Hilux");
    await page.locator('aside input[aria-label="Minimum year"]').fill("2020");
    await page.locator('aside input[aria-label="Maximum year"]').fill("2022");
    await page.locator('aside form button[type="submit"]').first().click();

    await waitUntil("Filtered to Hilux 2020-2022 before saving search", async () => {
      const hiluxVis = await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").count();
      const rangerVis = await page.getByText("2020 Ford Ranger Wildtrak 3.2 UAT").count();
      return hiluxVis === 1 && rangerVis === 0;
    }, 15000);

    await page.locator('button[aria-label="Save this search"]').click();
    const saveDialog = page.getByRole("dialog");
    await saveDialog.locator("#save-search-name").fill("Hilux 2020-2022 UAT");
    await saveDialog.getByRole("button", { name: /^Save search$/i }).click();
    await saveDialog.waitFor({ state: "hidden", timeout: 15000 });

    await page.goto(`${gwUrl}/#/my/searches`, { waitUntil: "networkidle" });
    // Full reload to prove TrailBase + Trade Engine persistence
    await page.reload({ waitUntil: "networkidle" });

    await page.getByText("Hilux 2020-2022 UAT").waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("Model: Hilux").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Year: 2020–2022").waitFor({ state: "visible", timeout: 10000 });
    await saveShot(page, "04-saved-searches.png", manifestEntries);

    await page.locator('a[aria-label*="Hilux 2020-2022 UAT"]').click();
    await waitUntil("Deep-link from Saved Searches restores Hilux results", async () => {
      const hash = page.url();
      const hiluxVis = await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").count();
      const rangerVis = await page.getByText("2020 Ford Ranger Wildtrak 3.2 UAT").count();
      return hash.includes("model=Hilux") && hiluxVis === 1 && rangerVis === 0;
    }, 15000);
    console.log("UAT Flow 4 (Saved Searches Persistence, Reload & Deep-Link): PASS");

    // Flow 5: Responsive Viewports & Overflow Check
    await page.goto(`${gwUrl}/#/c/vehicles`, { waitUntil: "networkidle" });
    await page.getByText("2021 Toyota Hilux 2.8 GD-6 4x4 UAT").waitFor({ state: "visible", timeout: 15000 });

    const viewports = [
      { name: "desktop", width: 1280, height: 800, shot: "05-desktop-1280.png" },
      { name: "tablet", width: 768, height: 1024, shot: "06-tablet-768.png" },
      { name: "mobile", width: 390, height: 844, shot: "07-mobile-390.png" },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await sleep(250);
      const overflow = await page.evaluate(() => {
        const vw = window.innerWidth;
        const culprits = [];
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1) {
            culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (right=${Math.round(r.right)})`);
          }
        }
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: vw,
          culprits: culprits.slice(0, 10),
        };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.innerWidth + 1,
        `${vp.name} (${vp.width}x${vp.height}) horizontal overflow: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}; culprits=${JSON.stringify(overflow.culprits)}`,
      );
      await saveShot(page, vp.shot, manifestEntries);
    }
    console.log("UAT Flow 5 (Responsive Viewports 1280/768/390 Zero Overflow): PASS");

    assert.equal(buyerMonitors.privacyLeaks.length, 0, `Buyer network privacy leaks: ${buyerMonitors.privacyLeaks.join("; ")}`);
    assert.equal(buyerMonitors.consoleErrors.length, 0, `Buyer console errors: ${buyerMonitors.consoleErrors.join("; ")}`);
    assert.equal(buyerMonitors.pageErrors.length, 0, `Buyer page errors: ${buyerMonitors.pageErrors.join("; ")}`);
    assert.equal(buyerMonitors.server5xx.length, 0, `Buyer HTTP 5xx: ${buyerMonitors.server5xx.join("; ")}`);

    await buyerCtx.close();

    // ────────────────────────────────────────────────────────────────
    // Generate SHA-256 Manifest
    // ────────────────────────────────────────────────────────────────
    let headSha = "unknown";
    try {
      headSha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      headSha = "local-dev";
    }

    const manifest = {
      testSuite: "PI-01E Dedicated Chromium Browser UAT - Structured Discovery, Filters, Comparison & Saved Searches",
      candidateSha: headSha,
      ciRunId: process.env.GITHUB_RUN_ID || "local",
      generatedAt: new Date().toISOString(),
      files: manifestEntries,
    };

    const manifestPath = path.join(LOCAL_UAT_DIR, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    if (ARTIFACT_SCREENSHOT_DIR !== LOCAL_UAT_DIR) {
      try {
        fs.writeFileSync(path.join(ARTIFACT_SCREENSHOT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
      } catch {
        /* ignore external artifact sync in CI */
      }
    }
    console.log(`Saved UAT evidence manifest (${manifestEntries.length} files) to ${manifestPath}`);
    console.log("PI-01E REAL-BROWSER CHROMIUM UAT: ALL 5 FLOWS PASS (0 console errors, 0 page errors, 0 HTTP 5xx, 0 privacy leaks)");
  } catch (err) {
    console.error("PI-01E UAT FAILED:", err);
    console.error("=== TrailBase logs ===\n", logs.tb.slice(-20).join(""));
    console.error("=== Trade Engine logs ===\n", logs.te.slice(-20).join(""));
    console.error("=== Next.js logs ===\n", logs.next.slice(-20).join(""));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of socketsToClose) {
      try { s.close(); } catch { /* ignore */ }
    }
    if (gwServer) gwServer.close();
    for (const p of [nextProc, teProc, tbProc]) {
      if (p && !p.killed) {
        try { p.kill("SIGTERM"); } catch { /* ignore */ }
      }
    }
    await sleep(300);
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

main();
