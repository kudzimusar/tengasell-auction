import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { io, type Socket } from "socket.io-client";

const ROOT = path.resolve(import.meta.dir, "../..");
const TRAIL_BIN = path.join(ROOT, ".tools/tb/trail");
const TEMPLATE_DEPOT = path.join(ROOT, "mini-services/trailbase-db/traildepot");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";
const USER_PASSWORD = "TestUser#2025";

let tmpRoot = "";
let depotDir = "";
let dataDir = "";
let tbPort = 0;
let tePort = 0;
let tbUrl = "";
let teUrl = "";
let tbProc: ChildProcess | null = null;
let teProc: ChildProcess | null = null;
const socketsToClose: Socket[] = [];

type UserSession = {
  username: string;
  userId: string;
  token: string;
  socket: Socket;
};

const users: Record<string, UserSession> = {};
let anonSocket: Socket;

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Could not allocate ephemeral port")));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "not started";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status > 0) return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastErr}`);
}

async function waitUntil(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = 12_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function decodeSub(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  return String(payload.sub ?? "");
}

async function tbJson(
  method: string,
  apiPath: string,
  token?: string | null,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${tbUrl}${apiPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function connectSocket(token?: string | null): Promise<Socket> {
  return await new Promise((resolve, reject) => {
    const s = io(teUrl, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      ...(token ? { auth: { token } } : {}),
    });
    const timer = setTimeout(() => {
      s.close();
      reject(new Error("Socket.IO connection timeout"));
    }, 8000);
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
}

async function rpc<T = any>(socket: Socket, event: string, payload: unknown, timeoutMs = 20_000): Promise<T> {
  return await new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err: Error | null, response: T) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

async function registerAndLogin(username: string): Promise<UserSession> {
  const reg = await tbJson("POST", "/api/auth/v1/register", null, {
    username,
    password: USER_PASSWORD,
    password_repeat: USER_PASSWORD,
  });
  if (reg.status >= 400) {
    throw new Error(`Register failed for ${username}: ${reg.status} ${reg.text}`);
  }
  const login = await tbJson("POST", "/api/auth/v1/login", null, {
    username,
    password: USER_PASSWORD,
  });
  if (login.status >= 400 || !login.json?.auth_token) {
    throw new Error(`Login failed for ${username}: ${login.status} ${login.text}`);
  }
  const token = String(login.json.auth_token);
  const socket = await connectSocket(token);
  return {
    username,
    userId: decodeSub(token),
    token,
    socket,
  };
}

async function loginAdmin(): Promise<UserSession> {
  const login = await tbJson("POST", "/api/auth/v1/login", null, {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  if (login.status >= 400 || !login.json?.auth_token) {
    throw new Error(`Admin login failed: ${login.status} ${login.text}`);
  }
  const token = String(login.json.auth_token);
  const socket = await connectSocket(token);
  return {
    username: ADMIN_USERNAME,
    userId: decodeSub(token),
    token,
    socket,
  };
}

function queryMainDb<T = any>(sql: string, ...args: any[]): T[] {
  const db = new Database(path.join(dataDir, "main.db"), { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout = 3000;");
    return db.query(sql).all(...args) as T[];
  } finally {
    db.close();
  }
}

function killChild(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

beforeAll(async () => {
  if (!fs.existsSync(TRAIL_BIN)) {
    throw new Error(`TrailBase binary not found at ${TRAIL_BIN}`);
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tgs-pi-rbac-"));
  depotDir = path.join(tmpRoot, "traildepot");
  dataDir = path.join(depotDir, "data");
  fs.cpSync(TEMPLATE_DEPOT, depotDir, { recursive: true });

  tbPort = await getFreePort();
  tePort = await getFreePort();
  tbUrl = `http://127.0.0.1:${tbPort}`;
  teUrl = `http://127.0.0.1:${tePort}`;

  const tbLogs: string[] = [];
  tbProc = spawn(
    TRAIL_BIN,
    ["--depot", depotDir, "run", "--address", `127.0.0.1:${tbPort}`, "--dev"],
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  tbProc.stdout?.on("data", (d) => tbLogs.push(d.toString()));
  tbProc.stderr?.on("data", (d) => tbLogs.push(d.toString()));

  await waitForHttp(`${tbUrl}/api/records/v1/categories`, 20_000).catch((err) => {
    throw new Error(`${err.message}\nTrailBase logs:\n${tbLogs.join("")}`);
  });

  const teLogs: string[] = [];
  teProc = spawn("bun", ["run", "mini-services/trade-engine/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(tePort),
      TRAILBASE_URL: tbUrl,
      TRAILBASE_DATA_DIR: dataDir,
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  teProc.stdout?.on("data", (d) => teLogs.push(d.toString()));
  teProc.stderr?.on("data", (d) => teLogs.push(d.toString()));

  await waitForHttp(`${teUrl}/`, 20_000).catch((err) => {
    throw new Error(`${err.message}\nTrade engine logs:\n${teLogs.join("")}`);
  });

  users.admin = await loginAdmin();
  users.sellerA = await registerAndLogin("sellera1");
  users.sellerB = await registerAndLogin("sellerb2");
  users.inspector = await registerAndLogin("inspector3");
  users.reviewer = await registerAndLogin("reviewerd4");
  users.logoutUser = await registerAndLogin("logoute5");
  anonSocket = await connectSocket(null);

  // Confirm trade-engine established its own admin session before RPCs begin.
  await waitUntil("trade-engine admin session ready", async () => {
    const res = await rpc<any>(users.admin.socket, "product:search:rebuild", {});
    return res?.ok === true;
  }, 15_000, 250);
}, 45_000);

afterAll(async () => {
  for (const s of socketsToClose) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  killChild(teProc);
  killChild(tbProc);
  await Bun.sleep(250);
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

const STATE: {
  auctionAId?: number;
  sessionAId?: number;
  vehicleAId?: number;
  documentAId?: number;
  inspectionAId?: number;
  draftAuctionId?: number;
  auctionCId?: number;
  savedSearchAId?: number;
} = {};

const BASE_VEHICLE_A = {
  vin: "JTM11223344556677",
  chassisNumber: "CH998877",
  registrationNumber: "ZWE4499",
  make: "Toyota",
  model: "Hilux",
  variant: "2.8 GD-6 Legend 50",
  modelYear: 2021,
  manufactureYear: 2021,
  engineNumber: "1GD554433",
  engineDisplacementCc: 2755,
  fuelType: "DIESEL",
  transmission: "AUTOMATIC",
  drivetrain: "4WD",
  odometerKm: 48200,
  locationCity: "Harare",
  ownershipStatus: "DECLARED_OWNER",
  customsStatus: "LOCAL",
  requestedDurationHours: 72,
  vehicleClass: "PICKUP",
  bodyType: "PICKUP_DOUBLE_CAB",
  steeringSide: "RIGHT",
  doors: 4,
  seats: 5,
  cabType: "DOUBLE",
  primaryExteriorColour: "WHITE",
  serviceHistoryClass: "FULL_MANUFACTURER",
  accidentHistory: "NONE_DECLARED",
};

test("Case 1: Unauthenticated anonymous denial across Socket.IO RPC & TrailBase REST", async () => {
  const blockedRpcs: Array<[string, Record<string, unknown>]> = [
    ["product:intake:open", { intake: { commandId: "anon-open-1", categoryKey: "VEHICLE_PASSENGER_CAR", title: "Anon Test" } }],
    ["product:intake:step", { step: { commandId: "anon-step-1", sessionId: 1, expectedRevision: 0, stepKey: "CATEGORY", complete: true } }],
    ["product:intake:publish", { command: { commandId: "anon-pub-1", sessionId: 1, expectedRevision: 1, commandType: "PUBLISH" } }],
    ["vehicle:get", { auctionId: 1 }],
    ["vehicle:intake", { auctionId: 1, vehicle: BASE_VEHICLE_A }],
    ["vehicle:document:add", { vehicleId: 1, document: { documentType: "REGISTRATION", documentRef: "ANON-DOC" } }],
    ["saved-search:save", { name: "Anon search", facets: [{ attributeKey: "MAKE", optionValue: "Toyota" }] }],
    ["saved-search:facets:get", { savedSearchId: 1 }],
    ["product:search:rebuild", {}],
  ];

  for (const [event, payload] of blockedRpcs) {
    const res = await rpc<any>(anonSocket, event, payload);
    expect(res?.ok).toBe(false);
  }

  // Direct TrailBase REST writes must be rejected without authentication (401/403).
  const restWrites: Array<[string, string, unknown]> = [
    ["POST", "/api/records/v1/saved_searches", { name: "Anon REST", query: "Hilux", frequency: "daily", alerts_enabled: 1 }],
    ["POST", "/api/records/v1/saved_search_facets", { saved_search_id: 1, attribute_id: 1, operator: "EQ", value_text: "Toyota" }],
    ["POST", "/api/records/v1/product_intake_sessions", { auction_id: 99999, owner_user: "fake", owner_username: "fake", category_id: 1, schema_version_id: 1, state: "DRAFT" }],
    ["POST", "/api/records/v1/product_search_index", { auction_id: 99999, product_category_id: 1, category_key: "VEHICLE_PASSENGER_CAR", schema_version_id: 1, title: "Spoof", indexed_at: "2026-01-01T00:00:00Z" }],
    ["POST", "/api/records/v1/pi_fact_assertions", { product_type: "VEHICLE", product_id: 1, attribute_id: 1, value_text: "Spoof", source_class: "SELLER_DECLARED", verification_state: "VERIFIED", actor_id: "fake" }],
  ];

  for (const [method, endpoint, body] of restWrites) {
    const res = await tbJson(method, endpoint, null, body);
    expect(res.status === 401 || res.status === 403).toBe(true);
  }
});

test("Case 2: Seller A structured intake & private vehicle read; Seller B cross-seller denial", async () => {
  const openRes = await rpc<any>(users.sellerA.socket, "product:intake:open", {
    intake: {
      commandId: `open-a-${Date.now()}`,
      categoryKey: "VEHICLE_PASSENGER_CAR",
      title: "2021 Toyota Hilux Legend 50 RBAC Proof",
      slug: `hilux-rbac-${Date.now()}`,
      description: "Live runtime certification fixture for Seller A.",
      condition: "used",
      start_price: 22000,
      reserve_price: 26000,
      shipping_fee: 0,
      shipping: "pickup",
      city: "Harare",
      ends_at: "2030-06-01T00:00:00Z",
      images: [],
      allow_offers: false,
    },
  });
  expect(openRes.ok).toBe(true);
  expect(openRes.auction?.id).toBeGreaterThan(0);
  expect(openRes.session?.id).toBeGreaterThan(0);

  STATE.auctionAId = Number(openRes.auction.id);
  STATE.sessionAId = Number(openRes.session.id);

  // Seller A saves confidential identifiers via vehicle:intake
  const intakeRes = await rpc<any>(users.sellerA.socket, "vehicle:intake", {
    auctionId: STATE.auctionAId,
    vehicle: BASE_VEHICLE_A,
  });
  expect(intakeRes).toMatchObject({ ok: true });
  expect(intakeRes.vehicle?.id).toBeGreaterThan(0);
  STATE.vehicleAId = Number(intakeRes.vehicle.id);

  // Seller A saves structured intake steps & publishes readiness/intake
  const step1 = await rpc<any>(users.sellerA.socket, "product:intake:step", {
    step: {
      commandId: `step-a-1-${Date.now()}`,
      sessionId: STATE.sessionAId,
      expectedRevision: Number(openRes.session.revision),
      stepKey: "IDENTITY",
      complete: true,
      data: { make: "Toyota", model: "Hilux", year: 2021 },
    },
  });
  expect(step1).toMatchObject({ ok: true });

  const pubCheck = await rpc<any>(users.sellerA.socket, "product:intake:publish", {
    command: {
      commandId: `ready-a-${Date.now()}`,
      sessionId: STATE.sessionAId,
      expectedRevision: Number(step1.session.revision),
      commandType: "CHECK_READY",
    },
  });
  expect(pubCheck).toMatchObject({ ok: true });

  const pub = await rpc<any>(users.sellerA.socket, "product:intake:publish", {
    command: {
      commandId: `pub-a-${Date.now()}`,
      sessionId: STATE.sessionAId,
      expectedRevision: Number(pubCheck.session.revision),
      commandType: "PUBLISH",
    },
  });
  expect(pub).toMatchObject({ ok: true });
  expect(pub.session?.state).toBe("PUBLISHED");

  // Seller A can read own private vehicle:get
  const ownBundle = await rpc<any>(users.sellerA.socket, "vehicle:get", { auctionId: STATE.auctionAId });
  expect(ownBundle.ok).toBe(true);
  expect(ownBundle.bundle?.vehicle?.vin).toBe("JTM11223344556677");
  expect(ownBundle.bundle?.vehicle?.registration_number).toBe("ZWE4499");

  // Seller B is denied private vehicle:get, product:intake:get, step, publish, and TrailBase session read
  const bVehicle = await rpc<any>(users.sellerB.socket, "vehicle:get", { auctionId: STATE.auctionAId });
  expect(bVehicle.ok).toBe(false);

  const bResume = await rpc<any>(users.sellerB.socket, "product:intake:get", { auctionId: STATE.auctionAId });
  expect(bResume.ok).toBe(false);

  const bStep = await rpc<any>(users.sellerB.socket, "product:intake:step", {
    step: {
      commandId: `b-step-hijack-${Date.now()}`,
      sessionId: STATE.sessionAId,
      expectedRevision: Number(pub.session.revision),
      stepKey: "IDENTITY",
      complete: true,
      data: { hacked: true },
    },
  });
  expect(bStep.ok).toBe(false);

  const bRestList = await tbJson(
    "GET",
    `/api/records/v1/product_intake_sessions?filter[id][$eq]=${STATE.sessionAId}`,
    users.sellerB.token,
  );
  const bRestRows = Array.isArray(bRestList.json?.records) ? bRestList.json.records : [];
  expect(bRestRows.length).toBe(0);

  const bRestById = await tbJson(
    "GET",
    `/api/records/v1/product_intake_sessions/${STATE.sessionAId}`,
    users.sellerB.token,
  );
  expect(bRestById.status === 403 || bRestById.status === 404).toBe(true);
});

test("Case 3: Inspector/Reviewer RBAC & Maker-Checker enforcement on live runtime", async () => {
  const vehicleId = STATE.vehicleAId!;

  // Non-inspector Seller B cannot start an inspection
  const deniedStart = await rpc<any>(users.sellerB.socket, "vehicle:inspection:start", { vehicleId });
  expect(deniedStart.ok).toBe(false);

  // Admin grants INSPECTOR role to inspector3, and REVIEWER role to reviewerd4
  const grantInsp = await rpc<any>(users.admin.socket, "vehicle:role:grant", {
    user: users.inspector.userId,
    username: users.inspector.username,
    role: "INSPECTOR",
  });
  expect(grantInsp.ok).toBe(true);

  const grantRev = await rpc<any>(users.admin.socket, "vehicle:role:grant", {
    user: users.reviewer.userId,
    username: users.reviewer.username,
    role: "REVIEWER",
  });
  expect(grantRev.ok).toBe(true);

  // Seller A attaches REGISTRATION + OWNERSHIP docs; Inspector reviews & verifies both
  const docRes = await rpc<any>(users.sellerA.socket, "vehicle:document:add", {
    vehicleId,
    document: {
      documentType: "REGISTRATION",
      documentRef: "DOC-PRIV-001",
      issuer: "CVR Zimbabwe",
      storageRef: "vault://docs/doc-priv-001.pdf",
      documentNumber: "ZWE-BOOK-7788",
      artifactRequired: true,
    },
  });
  expect(docRes).toMatchObject({ ok: true });
  STATE.documentAId = Number(docRes.document.id);

  const ownDocA = await rpc<any>(users.sellerA.socket, "vehicle:document:add", {
    vehicleId,
    document: {
      documentType: "OWNERSHIP",
      documentRef: "DOC-OWN-001",
      issuer: "CVR Zimbabwe",
      storageRef: "vault://docs/doc-own-001.pdf",
      documentNumber: "ZWE-OWN-7788",
      artifactRequired: true,
    },
  });
  expect(ownDocA).toMatchObject({ ok: true });

  // Seller B cannot review document
  const bDocRev = await rpc<any>(users.sellerB.socket, "vehicle:document:review", {
    documentId: STATE.documentAId,
    action: "VERIFY",
  });
  expect(bDocRev.ok).toBe(false);

  const inspDocRev = await rpc<any>(users.inspector.socket, "vehicle:document:review", {
    documentId: STATE.documentAId,
    action: "VERIFY",
    derivedFact: {
      attributeKey: "CUSTOMS_STATUS",
      value: "LOCAL",
      extractionPath: "registration.customsStatus",
    },
  });
  expect(inspDocRev).toMatchObject({ ok: true });
  expect(inspDocRev.document?.status).toBe("VERIFIED");

  const inspOwnRev = await rpc<any>(users.inspector.socket, "vehicle:document:review", {
    documentId: Number(ownDocA.document.id),
    action: "VERIFY",
  });
  expect(inspOwnRev).toMatchObject({ ok: true });

  // Inspector starts inspection, adds finding, and submits
  const startRes = await rpc<any>(users.inspector.socket, "vehicle:inspection:start", { vehicleId });
  expect(startRes.ok).toBe(true);
  STATE.inspectionAId = Number(startRes.inspection.id);

  const findRes = await rpc<any>(users.inspector.socket, "vehicle:inspection:finding", {
    inspectionId: STATE.inspectionAId,
    finding: {
      category: "BODY",
      component: "Tailgate",
      location: "Rear",
      severity: "MINOR",
      description: "Light tailgate scratch consistent with utility use.",
      repairRecommended: false,
      safetyCritical: false,
    },
  });
  expect(findRes.ok).toBe(true);

  const subRes = await rpc<any>(users.inspector.socket, "vehicle:inspection:submit", {
    inspectionId: STATE.inspectionAId,
    inspection: { roadworthy: true, odometerKm: 48200, notes: "Verified sound mechanical condition." },
  });
  expect(subRes.ok).toBe(true);
  expect(subRes.inspection?.lifecycle).toBe("SUBMITTED");

  // Inspector without REVIEWER cannot review
  const selfNoRole = await rpc<any>(users.inspector.socket, "vehicle:inspection:review", {
    inspectionId: STATE.inspectionAId,
    commandId: `rev-self-norole-${Date.now()}`,
  });
  expect(selfNoRole.ok).toBe(false);

  // Even if inspector is ALSO granted REVIEWER, SQLite trigger blocks self-review (MAKER_CHECKER_REQUIRED)
  const grantInspRev = await rpc<any>(users.admin.socket, "vehicle:role:grant", {
    user: users.inspector.userId,
    username: users.inspector.username,
    role: "REVIEWER",
  });
  expect(grantInspRev.ok).toBe(true);

  const selfWithRole = await rpc<any>(users.inspector.socket, "vehicle:inspection:review", {
    inspectionId: STATE.inspectionAId,
    commandId: `rev-self-maker-${Date.now()}`,
  });
  expect(selfWithRole.ok).toBe(false);
  expect(String(selfWithRole.error ?? "")).toContain("MAKER_CHECKER_REQUIRED");

  // Distinct Reviewer approves AND automatically activates Auction A via canonical eligibility trigger
  const distinctRev = await rpc<any>(users.reviewer.socket, "vehicle:inspection:review", {
    inspectionId: STATE.inspectionAId,
    commandId: `rev-distinct-${Date.now()}`,
  });
  expect(distinctRev).toMatchObject({ ok: true });
  expect(distinctRev.command?.status).toBe("accepted");
  expect(distinctRev.command?.eligibility_status).toBe("ELIGIBLE");
  expect(distinctRev.bundle?.eligibility?.status).toBe("ELIGIBLE");
});

test("Case 4 & Case 5: Draft/unpublished denial + public projection & comparison privacy redaction", async () => {
  // Create an unpublished draft listing by Seller B and confirm anonymous public read rejects it
  const draftOpen = await rpc<any>(users.sellerB.socket, "product:intake:open", {
    intake: {
      commandId: `open-draft-${Date.now()}`,
      categoryKey: "VEHICLE_PASSENGER_CAR",
      title: "Unpublished Draft Vehicle Must Stay Hidden",
      slug: `draft-hidden-${Date.now()}`,
      description: "Must never surface publicly.",
      condition: "used",
      start_price: 15000,
      shipping_fee: 0,
      shipping: "pickup",
      city: "Bulawayo",
      ends_at: "2030-06-01T00:00:00Z",
      images: [],
    },
  });
  expect(draftOpen).toMatchObject({ ok: true });
  STATE.draftAuctionId = Number(draftOpen.auction.id);

  const draftPub = await rpc<any>(anonSocket, "product:public:get", { auctionId: STATE.draftAuctionId });
  expect(draftPub.ok).toBe(false);

  // Open & publish Auction C (Seller B) to test live 2-item compare + outbox/FTS5 updates
  const openC = await rpc<any>(users.sellerB.socket, "product:intake:open", {
    intake: {
      commandId: `open-c-${Date.now()}`,
      categoryKey: "VEHICLE_PASSENGER_CAR",
      title: "2019 Toyota Prado TX-L Automatic RBAC Fixture",
      slug: `prado-rbac-${Date.now()}`,
      description: "Clean Toyota Prado SUV live fixture for discovery comparison.",
      condition: "used",
      start_price: 34000,
      reserve_price: 38000,
      shipping_fee: 0,
      shipping: "pickup",
      city: "Bulawayo",
      ends_at: "2030-06-01T00:00:00Z",
      images: [],
    },
  });
  expect(openC.ok).toBe(true);
  STATE.auctionCId = Number(openC.auction.id);

  const intakeC = await rpc<any>(users.sellerB.socket, "vehicle:intake", {
    auctionId: STATE.auctionCId,
    vehicle: {
      ...BASE_VEHICLE_A,
      vin: "JTM99887766554433",
      chassisNumber: "CH554433",
      registrationNumber: "ZWE9911",
      engineNumber: "2TR887766",
      make: "Toyota",
      model: "Prado",
      variant: "TX-L",
      modelYear: 2019,
      odometerKm: 62000,
      locationCity: "Bulawayo",
      bodyType: "SUV",
    },
  });
  expect(intakeC).toMatchObject({ ok: true });

  const pubC = await rpc<any>(users.sellerB.socket, "product:intake:publish", {
    command: {
      commandId: `pub-c-${Date.now()}`,
      sessionId: Number(openC.session.id),
      expectedRevision: Number(openC.session.revision),
      commandType: "PUBLISH",
    },
  });
  expect(pubC.ok).toBe(true);

  // Helper to attach required docs, inspect & approve a vehicle so trg_vehicle_auction_live_gate permits status='live'
  const makeVehicleEligible = async (ownerSocket: Socket, vehicleId: number, suffix: string, odometerKm: number) => {
    for (const docType of ["REGISTRATION", "OWNERSHIP"] as const) {
      const doc = await rpc<any>(ownerSocket, "vehicle:document:add", {
        vehicleId,
        document: {
          documentType: docType,
          documentRef: `DOC-${docType}-${suffix}`,
          issuer: "CVR Zimbabwe",
          storageRef: `vault://docs/${docType.toLowerCase()}-${suffix}.pdf`,
          artifactRequired: true,
        },
      });
      expect(doc).toMatchObject({ ok: true });
      const revDoc = await rpc<any>(users.inspector.socket, "vehicle:document:review", {
        documentId: Number(doc.document.id),
        action: "VERIFY",
      });
      expect(revDoc).toMatchObject({ ok: true });
    }
    const start = await rpc<any>(users.inspector.socket, "vehicle:inspection:start", { vehicleId });
    expect(start).toMatchObject({ ok: true });
    const sub = await rpc<any>(users.inspector.socket, "vehicle:inspection:submit", {
      inspectionId: Number(start.inspection.id),
      inspection: { roadworthy: true, odometerKm, notes: "Roadworthy check passed." },
    });
    expect(sub).toMatchObject({ ok: true });
    const rev = await rpc<any>(users.reviewer.socket, "vehicle:inspection:review", {
      inspectionId: Number(start.inspection.id),
      commandId: `rev-elig-${suffix}-${Date.now()}`,
    });
    expect(rev).toMatchObject({ ok: true });
    expect(rev.bundle?.eligibility?.status).toBe("ELIGIBLE");
  };

  await makeVehicleEligible(users.sellerB.socket, Number(intakeC.vehicle.id), "c", 62000);

  // Transition Auction A and Auction C to 'live' as Admin, leaving STATE.draftAuctionId as 'draft'
  const patchA = await tbJson("PATCH", `/api/records/v1/auctions/${STATE.auctionAId}`, users.admin.token, {
    status: "live",
    current_price: 26500,
    updated_at: "2026-11-14T01:00:00Z",
  });
  expect({ status: patchA.status, body: patchA.text }).toEqual({ status: 200, body: patchA.text });

  const patchC = await tbJson("PATCH", `/api/records/v1/auctions/${STATE.auctionCId}`, users.admin.token, {
    status: "live",
    current_price: 38500,
    updated_at: "2026-11-14T01:00:00Z",
  });
  expect({ status: patchC.status, body: patchC.text }).toEqual({ status: 200, body: patchC.text });

  // Comparing a live auction with a draft auction must fail closed with COMPARE_LISTING_NOT_PUBLIC
  const cmpWithDraft = await rpc<any>(anonSocket, "product:compare", {
    auctionIds: [STATE.auctionAId, STATE.draftAuctionId],
  });
  expect(cmpWithDraft.ok).toBe(false);
  expect(cmpWithDraft.code).toBe("COMPARE_LISTING_NOT_PUBLIC");

  // Wait for outbox consumer to project both live listings into product_search_index
  await waitUntil("live auctions projected to product_search_index", async () => {
    const rows = queryMainDb<{ auction_id: number }>(
      "SELECT auction_id FROM product_search_index WHERE auction_id IN (?, ?, ?)",
      STATE.auctionAId,
      STATE.auctionCId,
      STATE.draftAuctionId,
    );
    const ids = new Set(rows.map((r) => Number(r.auction_id)));
    return ids.has(STATE.auctionAId!) && ids.has(STATE.auctionCId!) && !ids.has(STATE.draftAuctionId!);
  }, 15_000, 200);

  // Anonymous & Seller B public bundle, search, REST tables, and compare must NEVER leak VIN/reg/chassis/engine/docRef
  const sensitiveTokens = [
    "JTM11223344556677",
    "JTM99887766554433",
    "ZWE4499",
    "ZWE9911",
    "CH998877",
    "CH554433",
    "1GD554433",
    "2TR887766",
    "DOC-PRIV-001",
    "ZWE-BOOK-7788",
  ];

  const pubA = await rpc<any>(anonSocket, "product:public:get", { auctionId: STATE.auctionAId });
  expect(pubA.ok).toBe(true);
  const cmpLive = await rpc<any>(anonSocket, "product:compare", {
    auctionIds: [STATE.auctionAId, STATE.auctionCId],
  });
  expect(cmpLive.ok).toBe(true);
  expect(cmpLive.comparison?.items?.length).toBe(2);

  const cmpSerialized = JSON.stringify(cmpLive);
  const pubSerialized = JSON.stringify(pubA);
  for (const secret of sensitiveTokens) {
    expect(pubSerialized).not.toContain(secret);
    expect(cmpSerialized).not.toContain(secret);
  }
  expect(cmpSerialized).toContain("REDACTED");
  expect(cmpSerialized).toContain("Recorded privately");

  // Direct TrailBase REST access to confidential tables must fail for Anonymous & Seller B
  for (const tok of [null, users.sellerB.token]) {
    const docsRes = await tbJson("GET", "/api/records/v1/vehicle_documents", tok);
    expect(docsRes.status === 401 || docsRes.status === 403 || (docsRes.json?.records?.length ?? 0) === 0).toBe(true);

    const factsRes = await tbJson("GET", "/api/records/v1/pi_effective_facts", tok);
    if (tok == null) {
      expect(factsRes.status === 401 || factsRes.status === 403).toBe(true);
    } else {
      expect(
        factsRes.status === 401 ||
          factsRes.status === 403 ||
          (factsRes.status === 200 && Array.isArray(factsRes.json?.records) && factsRes.json.records.length === 0),
      ).toBe(true);
    }

    const psiRes = await tbJson("GET", "/api/records/v1/product_search_index", tok);
    expect(psiRes.status).toBe(200);
    const psiSerialized = JSON.stringify(psiRes.json);
    for (const secret of sensitiveTokens) {
      expect(psiSerialized).not.toContain(secret);
    }
    expect(psiSerialized).not.toContain(String(STATE.draftAuctionId));
  }
});

test("Case 6: Outbox & FTS5 runtime sync and withdrawn listing removal on TrailBase v0.35.1", async () => {
  // Mutate Auction C title & current_price -> verify SQLite trigger enqueues SEARCH_INDEX_REFRESH and outbox updates index + FTS5
  const uniqueToken = "FortunerQuantumSync99";
  const upd = await tbJson("PATCH", `/api/records/v1/auctions/${STATE.auctionCId}`, users.admin.token, {
    title: `2019 Toyota Prado ${uniqueToken}`,
    current_price: 41250,
    updated_at: "2026-11-14T01:05:00Z",
  });
  expect(upd.status).toBe(200);

  await waitUntil("updated title/price drained from outbox into FTS5 + product_search_index", async () => {
    const res = await rpc<any>(anonSocket, "product:search:query", { query: { search: uniqueToken } });
    return (
      res?.ok === true &&
      Array.isArray(res.items) &&
      res.items.some((it: any) => Number(it.auction_id) === STATE.auctionCId && Number(it.price) === 41250)
    );
  }, 15_000, 200);

  // Confirm draft auction is excluded from FTS search
  const draftSearch = await rpc<any>(anonSocket, "product:search:query", { query: { search: "Unpublished Draft Vehicle" } });
  expect(draftSearch).toMatchObject({ ok: true });
  expect(draftSearch.items.some((it: any) => Number(it.auction_id) === STATE.draftAuctionId)).toBe(false);

  // Transition Auction C to withdrawn -> outbox removes it from search index & public APIs reject it
  const withdrawRes = await tbJson("PATCH", `/api/records/v1/auctions/${STATE.auctionCId}`, users.admin.token, {
    status: "withdrawn",
    updated_at: "2026-11-14T01:10:00Z",
  });
  expect(withdrawRes.status).toBe(200);

  await waitUntil("withdrawn auction removed from product_search_index & FTS5", async () => {
    const res = await rpc<any>(anonSocket, "product:search:query", { query: { search: uniqueToken } });
    const psiRows = queryMainDb<{ auction_id: number }>(
      "SELECT auction_id FROM product_search_index WHERE auction_id = ?",
      STATE.auctionCId,
    );
    return res?.ok === true && res.items.length === 0 && psiRows.length === 0;
  }, 15_000, 200);

  const withdrawnPub = await rpc<any>(anonSocket, "product:public:get", { auctionId: STATE.auctionCId });
  expect(withdrawnPub.ok).toBe(false);

  const withdrawnCmp = await rpc<any>(anonSocket, "product:compare", {
    auctionIds: [STATE.auctionAId, STATE.auctionCId],
  });
  expect(withdrawnCmp.ok).toBe(false);
  expect(withdrawnCmp.code).toBe("COMPARE_LISTING_NOT_PUBLIC");
});

test("Case 7: Saved search & structured facet RBAC enforcement across Socket.IO & TrailBase REST", async () => {
  // Invalid operator must fail closed cleanly
  const badOp = await rpc<any>(users.sellerA.socket, "saved-search:save", {
    search: {
      name: "Bad Operator",
      facets: [{ attributeKey: "YEAR", operator: "RANGE", minNumeric: 2018, maxNumeric: 2025 }],
    },
  });
  expect(badOp.ok).toBe(false);
  expect(badOp.code).toBe("SAVED_SEARCH_INVALID_OPERATOR");

  // Seller A saves structured saved search with facets using valid BETWEEN operator
  const saveRes = await rpc<any>(users.sellerA.socket, "saved-search:save", {
    search: {
      name: "Toyota 2018+ Diesel",
      query: "Toyota",
      categoryKey: "VEHICLE_PASSENGER_CAR",
      frequency: "daily",
      alerts: true,
      facets: [
        { attributeKey: "MAKE", operator: "EQ", optionValue: "Toyota" },
        { attributeKey: "YEAR", operator: "BETWEEN", minNumeric: 2018, maxNumeric: 2025 },
      ],
    },
  });
  expect(saveRes).toMatchObject({ ok: true });
  expect(saveRes.savedSearch?.id).toBeGreaterThan(0);
  expect(Array.isArray(saveRes.savedSearch?.facets)).toBe(true);
  expect(saveRes.savedSearch.facets.length).toBe(2);
  STATE.savedSearchAId = Number(saveRes.savedSearch.id);

  // Seller A reads own saved search facets via Socket.IO & TrailBase REST
  const ownFacetsRpc = await rpc<any>(users.sellerA.socket, "saved-search:facets:get", {
    savedSearchId: STATE.savedSearchAId,
  });
  expect(ownFacetsRpc).toMatchObject({ ok: true });
  expect(ownFacetsRpc.facets.length).toBe(2);

  const aRestSearches = await tbJson("GET", "/api/records/v1/saved_searches", users.sellerA.token);
  expect(aRestSearches.status).toBe(200);
  expect(aRestSearches.json.records.some((r: any) => Number(r.id) === STATE.savedSearchAId)).toBe(true);

  const aRestFacets = await tbJson(
    "GET",
    `/api/records/v1/saved_search_facets?filter[saved_search_id][$eq]=${STATE.savedSearchAId}`,
    users.sellerA.token,
  );
  expect(aRestFacets.status).toBe(200);
  expect(aRestFacets.json.records.length).toBe(2);

  // Seller B is DENIED on Socket.IO cross-owner actions
  const bReadFacets = await rpc<any>(users.sellerB.socket, "saved-search:facets:get", {
    savedSearchId: STATE.savedSearchAId,
  });
  expect(bReadFacets.ok).toBe(false);

  const bOverwrite = await rpc<any>(users.sellerB.socket, "saved-search:save", {
    search: {
      id: STATE.savedSearchAId,
      name: "Hijacked",
      facets: [{ attributeKey: "MAKE", optionValue: "Nissan" }],
    },
  });
  expect(bOverwrite.ok).toBe(false);

  const bAlerts = await rpc<any>(users.sellerB.socket, "saved-search:alerts:set", {
    savedSearchId: STATE.savedSearchAId,
    alerts: false,
  });
  expect(bAlerts.ok).toBe(false);

  const bDelete = await rpc<any>(users.sellerB.socket, "saved-search:delete", {
    savedSearchId: STATE.savedSearchAId,
  });
  expect(bDelete.ok).toBe(false);

  // Seller B is DENIED on TrailBase REST cross-owner reads/writes/spoofing
  const bRestById = await tbJson("GET", `/api/records/v1/saved_searches/${STATE.savedSearchAId}`, users.sellerB.token);
  expect(bRestById.status === 403 || bRestById.status === 404).toBe(true);

  const bRestListFacets = await tbJson(
    "GET",
    `/api/records/v1/saved_search_facets?filter[saved_search_id][$eq]=${STATE.savedSearchAId}`,
    users.sellerB.token,
  );
  expect((bRestListFacets.json?.records ?? []).length).toBe(0);

  const bRestPatch = await tbJson(
    "PATCH",
    `/api/records/v1/saved_searches/${STATE.savedSearchAId}`,
    users.sellerB.token,
    { name: "Hijacked REST" },
  );
  expect(bRestPatch.status === 403 || bRestPatch.status === 404).toBe(true);

  const bRestDelete = await tbJson(
    "DELETE",
    `/api/records/v1/saved_searches/${STATE.savedSearchAId}`,
    users.sellerB.token,
  );
  expect(bRestDelete.status === 403 || bRestDelete.status === 404).toBe(true);

  // Attempt to insert a facet under Seller A's saved_search_id
  const makeAttr = queryMainDb<{ id: number }>(
    "SELECT id FROM pi_attribute_definitions WHERE attribute_key='MAKE' LIMIT 1",
  )[0];
  const bSpoofFacet = await tbJson(
    "POST",
    "/api/records/v1/saved_search_facets",
    users.sellerB.token,
    { saved_search_id: STATE.savedSearchAId, attribute_id: makeAttr.id, operator: "EQ", value_text: "Spoof" },
  );
  expect(bSpoofFacet.status === 401 || bSpoofFacet.status === 403).toBe(true);
});

test("Case 8: Search input bounds, pagination & admin-only rebuild on live runtime", async () => {
  const invalidQueries: Array<Record<string, unknown>> = [
    { minPrice: 50000, maxPrice: 1000 },
    { minYear: 2025, maxYear: 2015 },
    { minMileage: -5 },
    { limit: 0 },
    { limit: 500 },
    { offset: -1 },
    { status: "draft" },
    { order: "DROP TABLE auctions" },
  ];

  for (const invalid of invalidQueries) {
    const res = await rpc<any>(anonSocket, "product:search:query", { query: invalid });
    expect(res?.ok).toBe(false);
    expect(String(res?.code ?? "")).toContain("INVALID_");
  }

  // Ensure a second public listing exists alongside Auction A so pagination across 2+ rows is verified live
  const openD = await rpc<any>(users.sellerA.socket, "product:intake:open", {
    intake: {
      commandId: `open-d-${Date.now()}`,
      categoryKey: "VEHICLE_PASSENGER_CAR",
      title: "2020 Nissan Navara Double Cab Live Pagination Fixture",
      slug: `navara-pag-${Date.now()}`,
      description: "Live pagination fixture",
      condition: "used",
      start_price: 21000,
      reserve_price: 21500,
      shipping_fee: 0,
      shipping: "pickup",
      city: "Harare",
      ends_at: "2030-07-01T00:00:00Z",
      images: [],
    },
  });
  expect(openD).toMatchObject({ ok: true });
  const intakeD = await rpc<any>(users.sellerA.socket, "vehicle:intake", {
    auctionId: Number(openD.auction.id),
    vehicle: {
      ...BASE_VEHICLE_A,
      vin: "JN1CCNT32Z0001234",
      chassisNumber: "CHNAV1234",
      registrationNumber: "ZWE2020",
      engineNumber: "YS2312345",
      make: "Nissan",
      model: "Navara",
      variant: "LE",
      modelYear: 2020,
      odometerKm: 55000,
    },
  });
  expect(intakeD).toMatchObject({ ok: true });
  const pubD = await rpc<any>(users.sellerA.socket, "product:intake:publish", {
    command: {
      commandId: `pub-d-${Date.now()}`,
      sessionId: Number(openD.session.id),
      expectedRevision: Number(openD.session.revision),
      commandType: "PUBLISH",
    },
  });
  expect(pubD).toMatchObject({ ok: true });
  for (const docType of ["REGISTRATION", "OWNERSHIP"] as const) {
    const docD = await rpc<any>(users.sellerA.socket, "vehicle:document:add", {
      vehicleId: Number(intakeD.vehicle.id),
      document: {
        documentType: docType,
        documentRef: `DOC-${docType}-d`,
        issuer: "CVR Zimbabwe",
        storageRef: `vault://docs/${docType.toLowerCase()}-d.pdf`,
        artifactRequired: true,
      },
    });
    expect(docD).toMatchObject({ ok: true });
    const revDocD = await rpc<any>(users.inspector.socket, "vehicle:document:review", {
      documentId: Number(docD.document.id),
      action: "VERIFY",
    });
    expect(revDocD).toMatchObject({ ok: true });
  }
  const startD = await rpc<any>(users.inspector.socket, "vehicle:inspection:start", {
    vehicleId: Number(intakeD.vehicle.id),
  });
  expect(startD).toMatchObject({ ok: true });
  const subD = await rpc<any>(users.inspector.socket, "vehicle:inspection:submit", {
    inspectionId: Number(startD.inspection.id),
    inspection: { roadworthy: true, odometerKm: 55000, notes: "Pagination fixture inspection passed." },
  });
  expect(subD).toMatchObject({ ok: true });
  const revD = await rpc<any>(users.reviewer.socket, "vehicle:inspection:review", {
    inspectionId: Number(startD.inspection.id),
    commandId: `rev-d-${Date.now()}`,
  });
  expect(revD).toMatchObject({ ok: true });

  const patchD = await tbJson("PATCH", `/api/records/v1/auctions/${openD.auction.id}`, users.admin.token, {
    status: "live",
    current_price: 21500,
    updated_at: "2026-11-14T01:12:00Z",
  });
  expect({ status: patchD.status, body: patchD.text }).toEqual({ status: 200, body: patchD.text });

  // Seller A cannot run product:search:rebuild; Admin succeeds
  const sellerRebuild = await rpc<any>(users.sellerA.socket, "product:search:rebuild", {});
  expect(sellerRebuild.ok).toBe(false);

  const adminRebuild = await rpc<any>(users.admin.socket, "product:search:rebuild", {});
  expect(adminRebuild).toMatchObject({ ok: true });
  expect(adminRebuild.count).toBeGreaterThanOrEqual(2);

  // Paginated deterministic queries
  const page0 = await rpc<any>(anonSocket, "product:search:query", {
    query: {
      categoryKey: "VEHICLE_PASSENGER_CAR",
      limit: 1,
      offset: 0,
      order: "price_asc",
    },
  });
  const page1 = await rpc<any>(anonSocket, "product:search:query", {
    query: {
      categoryKey: "VEHICLE_PASSENGER_CAR",
      limit: 1,
      offset: 1,
      order: "price_asc",
    },
  });
  expect(page0.ok).toBe(true);
  expect(page1.ok).toBe(true);
  expect(page0.total).toBeGreaterThanOrEqual(2);
  expect(page0.items.length).toBe(1);
  expect(page1.items.length).toBe(1);
  expect(page0.items[0].auction_id).not.toBe(page1.items[0].auction_id);
});

test("Case 9: Revoked/logged-out session token rejection on existing and fresh sockets", async () => {
  const target = users.logoutUser;

  // Verify works before session invalidation
  const beforeList = await rpc<any>(target.socket, "saved-search:list", {});
  expect(beforeList).toMatchObject({ ok: true });

  // Revoke user's active TrailBase session (removes _session row so subsequent RPC auth checks fail closed)
  const revokeProc = Bun.spawnSync(
    [TRAIL_BIN, "--depot", depotDir, "user", "invalidate-session", target.username],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  expect(revokeProc.exitCode).toBe(0);

  // Existing connected socket must now fail protected calls
  const afterVehicle = await rpc<any>(target.socket, "vehicle:get", { auctionId: STATE.auctionAId });
  expect(afterVehicle.ok).toBe(false);
  expect(afterVehicle.code).toBe("AUTH_REQUIRED");

  const afterList = await rpc<any>(target.socket, "saved-search:list", {});
  expect(afterList.ok).toBe(false);
  expect(afterList.code).toBe("AUTH_REQUIRED");

  // Fresh socket presenting revoked token must also fail protected calls
  const staleSocket = await connectSocket(target.token);
  const staleList = await rpc<any>(staleSocket, "saved-search:list", {});
  expect(staleList.ok).toBe(false);
  expect(staleList.code).toBe("AUTH_REQUIRED");
});

test("Case 10: Fail-closed ADMIN_PASSWORD check across trailbase-admin.ts and trade-engine", async () => {
  // 1. trailbase-admin.ts must fail closed immediately without ADMIN_PASSWORD
  const adminHelperCheck = Bun.spawnSync(
    ["bun", "-e", 'import { tbLogin } from "./src/lib/server/trailbase-admin.ts"; tbLogin().then(() => process.exit(2), (e) => { console.error(e.message); process.exit(0); });'],
    {
      cwd: ROOT,
      env: { ...process.env, ADMIN_PASSWORD: "", TRAILBASE_URL: tbUrl },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(adminHelperCheck.exitCode).toBe(0);
  expect(adminHelperCheck.stderr.toString()).toContain("ADMIN_PASSWORD environment variable is required");

  // 2. trade-engine must not fall back to any hardcoded password when ADMIN_PASSWORD is empty
  const noPwPort = await getFreePort();
  const stderrChunks: string[] = [];
  const proc = spawn("bun", ["run", "mini-services/trade-engine/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(noPwPort),
      TRAILBASE_URL: tbUrl,
      TRAILBASE_DATA_DIR: dataDir,
      ADMIN_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (d) => stderrChunks.push(d.toString()));
  try {
    await waitUntil(
      "trade-engine logs fail-closed missing ADMIN_PASSWORD warning",
      async () => stderrChunks.join("").includes("ADMIN_PASSWORD environment variable is required"),
      10_000,
      100,
    );
  } finally {
    killChild(proc);
  }
  expect(stderrChunks.join("")).toContain("ADMIN_PASSWORD environment variable is required");
});
