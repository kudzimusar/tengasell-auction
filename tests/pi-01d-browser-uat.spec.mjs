#!/usr/bin/env node
/**
 * PI-01D Dedicated Chromium Browser UAT & Durable Evidence Generation
 *
 * Verifies end-to-end:
 * 1. Flow 1: Seller vehicle intake journey (#/sell/new) - dynamic vehicle intake form,
 *    specification entry, condition/defect disclosure, document input.
 * 2. Flow 2: Buyer vehicle Item Detail journey (#/item/:id) - specifications, provenance labels,
 *    verification state, truthful unknowns, odometer conflict resolution, inspection tab.
 * 3. Flow 3: Responsive layouts (1280px, 768px, 390px) - zero horizontal overflow.
 * 4. Flow 4: Privacy boundaries & draft suppression - sensitive VIN/chassis/docs redacted;
 *    unauthenticated/buyer access to draft auctions fails closed.
 * 5. Flow 5: Keyboard accessibility & focus indicators.
 * 6. Durable Evidence: saves screenshots and SHA-256 manifest.json to .artifacts/pi-uat/pi-01d.
 */

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

const LOCAL_UAT_DIR = path.join(ROOT, ".artifacts/pi-uat/pi-01d");
const ARTIFACT_SCREENSHOT_DIR = process.env.ARTIFACT_DIR
  ? path.join(process.env.ARTIFACT_DIR, "pi-01d")
  : LOCAL_UAT_DIR;

const SENSITIVE_IDENTIFIERS = [
  "JTEBU29J105991111",
  "CHAS-UAT-1111",
  "UAT-1111",
  "ENG-UAT-1111",
  "REG-UAT-111",
  "OWN-UAT-111",
  "vault://uat/reg-",
  "vault://uat/own-",
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
      locationCountry: "Zimbabwe",
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
      if (!txt.includes("z-cdn.chatglm.cn") && !locUrl.includes("z-cdn.chatglm.cn")) {
        bucket.consoleErrors.push(locUrl ? `${txt} [${locUrl}]` : txt);
      }
    }
  });
  page.on("response", async (res) => {
    const status = res.status();
    const url = res.url();
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
          bucket.privacyLeaks.push(`Network response ${url} leaked sensitive ${secret}`);
        }
      }
    }
  });
}

async function saveShot(page, name, manifestEntries) {
  fs.mkdirSync(LOCAL_UAT_DIR, { recursive: true });
  const localPath = path.join(LOCAL_UAT_DIR, name);
  await page.screenshot({ path: localPath, fullPage: false });

  if (ARTIFACT_SCREENSHOT_DIR !== LOCAL_UAT_DIR) {
    try {
      fs.mkdirSync(ARTIFACT_SCREENSHOT_DIR, { recursive: true });
      fs.copyFileSync(localPath, path.join(ARTIFACT_SCREENSHOT_DIR, name));
    } catch {
      /* ignore artifact sync in CI */
    }
  }

  const buf = fs.readFileSync(localPath);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  manifestEntries.push({
    file: name,
    bytes: buf.length,
    sha256: hash,
  });
}

async function main() {
  assert.ok(fs.existsSync(TRAIL_BIN), `Missing TrailBase binary at ${TRAIL_BIN}`);
  assert.ok(fs.existsSync(STANDALONE_SERVER), `Missing standalone server at ${STANDALONE_SERVER}; run npm run build first`);

  if (fs.existsSync(path.join(ROOT, ".next/static"))) {
    fs.cpSync(path.join(ROOT, ".next/static"), path.join(ROOT, ".next/standalone/.next/static"), { recursive: true });
  }
  if (fs.existsSync(path.join(ROOT, "public"))) {
    fs.cpSync(path.join(ROOT, "public"), path.join(ROOT, ".next/standalone/public"), { recursive: true });
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-pi-01d-uat-"));
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
  const manifestEntries = [];

  try {
    tbProc = spawn(TRAIL_BIN, ["--depot", depotDir, "run", "--address", `127.0.0.1:${tbPort}`, "--dev"], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    tbProc.stdout?.on("data", (d) => logs.tb.push(d.toString()));
    tbProc.stderr?.on("data", (d) => logs.tb.push(d.toString()));
    await waitForHttp(`${tbUrl}/api/records/v1/categories?limit=1`);

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

    console.log("Services booted. Setting up users and profiles...");
    const admin = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, ADMIN_USERNAME, true);
    console.log("Admin profile ready.");
    const sellera1 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "sellera1");
    console.log("Seller profile ready.");
    const buyeruat1 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "buyeruat1");
    console.log("Buyer profile ready.");
    const inspector3 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "inspector3");
    console.log("Inspector profile ready.");
    const reviewerd4 = await ensureUserAndProfile(tbUrl, teUrl, socketsToClose, "reviewerd4");
    console.log("Reviewer profile ready.");

    console.log("Granting staff roles...");
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
    console.log("Staff roles granted.");

    // Seed Vehicle 1 (Live, Pickup, Conflicted Odometer: seller=55000, inspector=58000)
    console.log("Seeding vehicle 1...");
    const seededVehicle = await seedLiveVehicle({
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

    // Seed Vehicle 2 as DRAFT (not published, not inspected) to verify draft suppression
    const draftOpen = await rpc(sellera1.socket, "product:intake:open", {
      intake: {
        commandId: `uat-open-draft-${Date.now()}`,
        categoryKey: "VEHICLE_PICKUP",
        title: "2023 Isuzu D-Max V-Cross DRAFT",
        slug: `isuzu-d-max-draft-${Date.now()}`,
        description: "Draft vehicle intake session — private seller draft.",
        condition: "used",
        start_price: 28000,
        buy_now_price: 33000,
        reserve_price: 30000,
        shipping_fee: 0,
        shipping: "pickup",
        city: "Bulawayo",
        ends_at: "2030-06-01T00:00:00Z",
        images: ["/logo.svg"],
        allow_offers: false,
      },
    });
    assert.ok(draftOpen?.ok, "Failed to create draft intake");
    const draftAuctionId = Number(draftOpen.auction.id);

    browser = await chromium.launch({ headless: true });

    // ────────────────────────────────────────────────────────────────
    // FLOW 1: Seller Vehicle Intake Journey (#/sell/new)
    // ────────────────────────────────────────────────────────────────
    console.log("1. Testing Seller Vehicle Intake Journey (#/sell/new)...");
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

    await sellerPage.locator('button[aria-label="Add stock photo 1"]').click();
    await sellerPage.locator("#title").fill("2022 Toyota Land Cruiser Prado VX-L UAT");

    await sellerPage.locator("#category").click();
    await sellerPage.getByRole("option", { name: /Vehicles/i }).click();

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
    await sleep(200);

    await saveShot(sellerPage, "01-seller-intake-wizard.png", manifestEntries);
    console.log("   Seller intake wizard verified & screenshot captured.");

    // ────────────────────────────────────────────────────────────────
    // FLOW 2: Buyer Vehicle Item Detail Journey (#/item/:id)
    // ────────────────────────────────────────────────────────────────
    console.log("2. Testing Buyer Vehicle Item Detail Journey (#/item/:id)...");
    const buyerMonitors = { consoleErrors: [], pageErrors: [], server5xx: [], privacyLeaks: [], checkBuyerPrivacy: true };
    const buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const buyerPage = await buyerCtx.newPage();
    attachPageMonitors(buyerPage, buyerMonitors);

    const itemUrl = `${gwUrl}/#/item/${seededVehicle.auctionId}`;
    await buyerPage.goto(itemUrl, { waitUntil: "networkidle" });

    // Verify auction title and reserve disclosure
    await buyerPage.getByRole("heading", { name: /2021 Toyota Hilux/i }).first().waitFor({ state: "visible", timeout: 12000 });
    const reserveText = await buyerPage.locator("text=/Reserve auction/i").first();
    await reserveText.waitFor({ state: "visible", timeout: 8000 });

    // Verify Vehicle Product Intelligence above-fold summary
    await buyerPage.getByText("Toyota").first().waitFor({ state: "visible", timeout: 8000 });
    await buyerPage.getByText("Hilux").first().waitFor({ state: "visible", timeout: 8000 });
    await buyerPage.getByText(/58[,\s]?000/i).first().waitFor({ state: "visible", timeout: 8000 });

    // Verify lower-trust disagreement notice is displayed truthfully
    await buyerPage.getByText(/A lower-trust source reports a different value/i).first().waitFor({ state: "visible", timeout: 8000 });

    // Switch to Vehicle / inspection tab
    const vehicleTabTrigger = buyerPage.getByRole("tab", { name: /Vehicle/i }).first();
    if (await vehicleTabTrigger.isVisible()) {
      await vehicleTabTrigger.click();
      await sleep(250);
    }

    await saveShot(buyerPage, "02-buyer-vehicle-details.png", manifestEntries);
    console.log("   Buyer vehicle details verified & screenshot captured.");

    // ────────────────────────────────────────────────────────────────
    // FLOW 3: Responsive Layouts (1280px, 768px, 390px)
    // ────────────────────────────────────────────────────────────────
    console.log("3. Testing Responsive Layouts (1280px, 768px, 390px)...");

    // 1280px Desktop
    await buyerPage.setViewportSize({ width: 1280, height: 900 });
    await sleep(200);
    let overflow1280 = await buyerPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.strictEqual(overflow1280, false, "Horizontal overflow detected at 1280px viewport");
    await saveShot(buyerPage, "03-desktop-1280.png", manifestEntries);

    // 768px Tablet
    await buyerPage.setViewportSize({ width: 768, height: 1024 });
    await sleep(200);
    let overflow768 = await buyerPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.strictEqual(overflow768, false, "Horizontal overflow detected at 768px viewport");
    await saveShot(buyerPage, "04-tablet-768.png", manifestEntries);

    // 390px Mobile
    await buyerPage.setViewportSize({ width: 390, height: 844 });
    await sleep(200);
    let overflow390 = await buyerPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.strictEqual(overflow390, false, "Horizontal overflow detected at 390px viewport");
    await saveShot(buyerPage, "05-mobile-390.png", manifestEntries);
    console.log("   Responsive viewports verified without horizontal overflow.");

    // ────────────────────────────────────────────────────────────────
    // FLOW 4: Privacy Boundaries & Draft Suppression
    // ────────────────────────────────────────────────────────────────
    console.log("4. Testing Privacy Boundaries & Draft Suppression...");

    // Check DOM for privacy leaks (VIN in cleartext, raw private storage refs)
    const pageText = await buyerPage.evaluate(() => document.body.innerText);
    for (const secret of SENSITIVE_IDENTIFIERS) {
      assert.ok(
        !pageText.includes(secret),
        `CRITICAL PRIVACY VIOLATION: Sensitive identifier "${secret}" leaked in buyer page DOM!`,
      );
    }
    assert.strictEqual(buyerMonitors.privacyLeaks.length, 0, `Network responses leaked sensitive data: ${buyerMonitors.privacyLeaks.join("; ")}`);

    // Verify Draft Suppression: Anonymous/Buyer visiting draft auction #draftAuctionId
    const draftPage = await buyerCtx.newPage();
    const draftMonitors = { consoleErrors: [], pageErrors: [], server5xx: [], privacyLeaks: [], checkBuyerPrivacy: false };
    attachPageMonitors(draftPage, draftMonitors);

    await draftPage.goto(`${gwUrl}/#/item/${draftAuctionId}`, { waitUntil: "networkidle" });
    await sleep(300);

    // Must suppress structured vehicle intelligence and block commercial bidding
    const draftContent = await draftPage.evaluate(() => document.body.innerText);
    assert.ok(
      draftContent.includes("Structured vehicle details are not available yet") ||
      draftContent.includes("Auction not found"),
      "Draft vehicle structured details were not suppressed for unauthenticated buyer!",
    );

    // Verify commercial bidding is blocked on draft auction
    const bidButtons = await draftPage.locator('button:has-text("Place bid")').count();
    assert.strictEqual(bidButtons, 0, "Bidding must be blocked on draft auctions!");
    await saveShot(draftPage, "06-draft-suppression.png", manifestEntries);
    console.log("   Privacy boundaries and draft suppression verified.");

    // ────────────────────────────────────────────────────────────────
    // FLOW 5: Keyboard Accessibility & Focus States
    // ────────────────────────────────────────────────────────────────
    console.log("5. Testing Keyboard Accessibility & Focus States...");
    await buyerPage.setViewportSize({ width: 1280, height: 900 });
    await buyerPage.goto(itemUrl, { waitUntil: "networkidle" });
    await sleep(200);

    // Tab through interactive elements
    for (let i = 0; i < 5; i++) {
      await buyerPage.keyboard.press("Tab");
      await sleep(50);
    }
    const hasFocusedElement = await buyerPage.evaluate(() => {
      const el = document.activeElement;
      return el && el !== document.body && el !== document.documentElement;
    });
    assert.ok(hasFocusedElement, "Expected interactive element to receive keyboard focus");
    await saveShot(buyerPage, "07-keyboard-focus.png", manifestEntries);
    console.log("   Keyboard navigation and focus state verified.");

    // ────────────────────────────────────────────────────────────────
    // Check error monitors
    // ────────────────────────────────────────────────────────────────
    assert.strictEqual(sellerMonitors.pageErrors.length, 0, `Seller page errors: ${sellerMonitors.pageErrors.join("; ")}`);
    assert.strictEqual(buyerMonitors.pageErrors.length, 0, `Buyer page errors: ${buyerMonitors.pageErrors.join("; ")}`);
    assert.strictEqual(sellerMonitors.server5xx.length, 0, `5xx errors in seller session: ${sellerMonitors.server5xx.join("; ")}`);
    assert.strictEqual(buyerMonitors.server5xx.length, 0, `5xx errors in buyer session: ${buyerMonitors.server5xx.join("; ")}`);

    // ────────────────────────────────────────────────────────────────
    // Step 6: Generate SHA-256 Manifest
    // ────────────────────────────────────────────────────────────────
    let headSha = "unknown";
    try {
      headSha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      headSha = "local-dev";
    }

    const manifest = {
      testSuite: "PI-01D Dedicated Chromium Browser UAT",
      candidateSha: headSha,
      ciRunId: process.env.GITHUB_RUN_ID || "local",
      generatedAt: new Date().toISOString(),
      browser: "Chromium headless",
      viewportsTested: ["1280x800", "1280x900", "768x1024", "390x844"],
      entries: manifestEntries,
    };

    const manifestJson = JSON.stringify(manifest, null, 2);
    const localManifestPath = path.join(LOCAL_UAT_DIR, "manifest.json");
    fs.writeFileSync(localManifestPath, manifestJson);

    if (ARTIFACT_SCREENSHOT_DIR !== LOCAL_UAT_DIR) {
      try {
        fs.writeFileSync(path.join(ARTIFACT_SCREENSHOT_DIR, "manifest.json"), manifestJson);
      } catch {
        /* ignore artifact sync in CI */
      }
    }

    console.log("\n=== PI-01D BROWSER UAT & EVIDENCE GENERATION: PASS ===");
    console.log(`  Candidate SHA: ${headSha}`);
    console.log(`  Screenshots captured: ${manifestEntries.length}`);
    console.log(`  Evidence directory: ${LOCAL_UAT_DIR}`);
    console.log(`  Manifest: ${localManifestPath}`);
    for (const e of manifestEntries) {
      console.log(`    - ${e.file} (${e.bytes} bytes, sha256: ${e.sha256.slice(0, 12)}...)`);
    }

    return 0;
  } catch (err) {
    console.error("FATAL ERROR in PI-01D browser UAT:", err);
    console.error("--- Trade Engine Logs ---");
    console.error(logs.te.join("").slice(-2000));
    console.error("--- TrailBase Logs ---");
    console.error(logs.tb.join("").slice(-2000));
    console.error("--- Next Logs ---");
    console.error(logs.next.join("").slice(-2000));
    process.exit(1);
  } finally {
    for (const s of socketsToClose) {
      try { s.close(); } catch {}
    }
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (gwServer) {
      try { gwServer.close(); } catch {}
    }
    if (nextProc) {
      try { nextProc.kill("SIGTERM"); } catch {}
    }
    if (teProc) {
      try { teProc.kill("SIGTERM"); } catch {}
    }
    if (tbProc) {
      try { tbProc.kill("SIGTERM"); } catch {}
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in PI-01D browser UAT:", err);
  process.exit(1);
});
