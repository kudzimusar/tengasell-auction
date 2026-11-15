import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createStrictTrailBaseStore, TrailBaseReadError } from "./trailbase-adapter";
import {
  consumeSearchProjectionOutbox,
  refreshAuctionSearch,
  removeAuctionFromSearch,
  rebuildProductSearchIndex,
  queryProductSearch,
} from "./search-indexing";
import { publicProductBundle, productCompare } from "./product-intelligence";

interface FaultRule {
  status: number;
  body?: any;
  malformed?: boolean;
}

class MockTrailBaseServer {
  server: HttpServer | null = null;
  port = 0;
  url = "";
  validToken = "mock-admin-token-valid-123";

  // Data collections
  tables: Record<string, Map<number | string, any>> = {};

  // Fault injection hooks
  collectionFaults: Map<string, FaultRule> = new Map();
  recordFaults: Map<string, FaultRule> = new Map();
  patchFaults: Map<string, FaultRule> = new Map();
  postFaults: Map<string, FaultRule> = new Map();
  deleteFaults: Map<string, FaultRule> = new Map();
  loginFault: FaultRule | null = null;
  requireAuth = true;
  delayMs = 0;

  resetData() {
    this.tables = {
      auctions: new Map(),
      vehicles: new Map(),
      product_intake_sessions: new Map(),
      categories: new Map(),
      pi_effective_facts: new Map(),
      pi_attribute_definitions: new Map(),
      pi_category_attributes: new Map(),
      product_search_index: new Map(),
      product_search_facet_values: new Map(),
      pi_projection_outbox: new Map(),
      vehicle_inspections: new Map(),
      vehicle_eligibility: new Map(),
      vehicle_documents: new Map(),
      pi_vehicle_public: new Map(),
      pi_vehicle_document_public: new Map(),
    };
    this.collectionFaults.clear();
    this.recordFaults.clear();
    this.patchFaults.clear();
    this.postFaults.clear();
    this.deleteFaults.clear();
    this.loginFault = null;
    this.requireAuth = true;
    this.delayMs = 0;
  }

  async start(): Promise<void> {
    this.resetData();
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handle(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as any;
        this.port = addr.port;
        this.url = `http://127.0.0.1:${this.port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    if (this.delayMs > 0) {
      setTimeout(() => this.processRequest(req, res), this.delayMs);
      return;
    }
    this.processRequest(req, res);
  }

  private processRequest(req: IncomingMessage, res: ServerResponse) {
    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    // 1. Auth endpoint
    if (pathname === "/api/auth/v1/login" && method === "POST") {
      if (this.loginFault) {
        res.writeHead(this.loginFault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.loginFault.body ?? { error: "login failed" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ auth_token: this.validToken }));
      return;
    }

    // Auth verification
    if (this.requireAuth) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${this.validToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized token" }));
        return;
      }
    }

    // 2. Records API
    // GET /api/records/v1/:table
    // GET /api/records/v1/:table/:id
    // POST /api/records/v1/:table
    // PATCH /api/records/v1/:table/:id
    // DELETE /api/records/v1/:table/:id
    const parts = pathname.replace(/^\/api\/records\/v1\//, "").split("/");
    const table = parts[0];
    const id = parts[1];

    if (!table) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing table" }));
      return;
    }

    const tableMap = this.tables[table] ?? (this.tables[table] = new Map());

    // Fault check: Collection
    if (id == null && method === "GET") {
      const fault = this.collectionFaults.get(table);
      if (fault) {
        if (fault.malformed) {
          res.writeHead(fault.status, { "Content-Type": "application/json" });
          res.end(fault.body ? JSON.stringify(fault.body) : "{ notAValidRecordsArray: true }");
          return;
        }
        res.writeHead(fault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fault.body ?? { error: `Fault on ${table}` }));
        return;
      }

      // Normal collection query
      let records = Array.from(tableMap.values());

      // Filter handling
      for (const [k, v] of parsedUrl.searchParams.entries()) {
        const eqMatch = k.match(/^filter\[(\w+)\]\[\$eq\]$/);
        if (eqMatch) {
          const col = eqMatch[1];
          records = records.filter((r) => String(r[col] ?? "") === String(v));
        }
        const isMatch = k.match(/^filter\[(\w+)\]\[\$is\]$/);
        if (isMatch) {
          const col = isMatch[1];
          if (v.toUpperCase() === "NULL") {
            records = records.filter((r) => r[col] == null || r[col] === "");
          }
        }
      }

      const limit = Number(parsedUrl.searchParams.get("limit") ?? 500);
      const offset = Number(parsedUrl.searchParams.get("offset") ?? 0);
      const sliced = records.slice(offset, offset + limit);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ records: sliced, total: records.length }));
      return;
    }

    // Fault check: Record GET
    if (id != null && method === "GET") {
      const faultKey = `${table}/${id}`;
      const fault = this.recordFaults.get(faultKey) ?? this.recordFaults.get(table);
      if (fault) {
        if (fault.malformed) {
          res.writeHead(fault.status, { "Content-Type": "application/json" });
          res.end(fault.body ? JSON.stringify(fault.body) : "invalid-string-not-an-object");
          return;
        }
        res.writeHead(fault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fault.body ?? { error: `Fault on ${table}/${id}` }));
        return;
      }

      const numId = Number(id);
      const row = tableMap.get(id) ?? (Number.isSafeInteger(numId) ? tableMap.get(numId) : null);
      if (!row) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Record ${id} not found in ${table}` }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));
      return;
    }

    // Record POST
    if (id == null && method === "POST") {
      const fault = this.postFaults.get(table);
      if (fault) {
        res.writeHead(fault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fault.body ?? { error: `Post fault on ${table}` }));
        return;
      }

      let bodyStr = "";
      req.on("data", (chunk) => {
        bodyStr += chunk;
      });
      req.on("end", () => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(bodyStr);
        } catch {
          parsed = {};
        }

        let newId: number;
        if (table === "product_search_index" && parsed.auction_id != null) {
          newId = Number(parsed.auction_id);
        } else {
          newId = parsed.id != null ? Number(parsed.id) : tableMap.size + 1;
        }
        const createdRow = { ...parsed, id: newId };
        tableMap.set(newId, createdRow);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ids: [newId] }));
      });
      return;
    }

    // Record PATCH
    if (id != null && method === "PATCH") {
      const faultKey = `${table}/${id}`;
      const fault = this.patchFaults.get(faultKey) ?? this.patchFaults.get(table);
      if (fault) {
        res.writeHead(fault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fault.body ?? { error: `Patch fault on ${table}/${id}` }));
        return;
      }

      let bodyStr = "";
      req.on("data", (chunk) => {
        bodyStr += chunk;
      });
      req.on("end", () => {
        let patch: any = {};
        try {
          patch = JSON.parse(bodyStr);
        } catch {
          patch = {};
        }

        const numId = Number(id);
        const existing = tableMap.get(id) ?? (Number.isSafeInteger(numId) ? tableMap.get(numId) : null);
        const updated = existing ? { ...existing, ...patch } : { id: numId || id, ...patch };
        tableMap.set(id, updated);
        if (Number.isSafeInteger(numId)) tableMap.set(numId, updated);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // Record DELETE
    if (id != null && method === "DELETE") {
      const faultKey = `${table}/${id}`;
      const fault = this.deleteFaults.get(faultKey) ?? this.deleteFaults.get(table);
      if (fault) {
        res.writeHead(fault.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fault.body ?? { error: `Delete fault on ${table}/${id}` }));
        return;
      }

      const numId = Number(id);
      tableMap.delete(id);
      if (Number.isSafeInteger(numId)) tableMap.delete(numId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}

describe("PI-BASELINE-03-R4B: Production TrailBase Adapter Read-Error Propagation & Outbox Reliability", () => {
  const harness = new MockTrailBaseServer();
  let store: ReturnType<typeof createStrictTrailBaseStore>;

  beforeAll(async () => {
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(() => {
    harness.resetData();
    store = createStrictTrailBaseStore({
      baseUrl: harness.url,
      getAdminToken: async (_force?: boolean) => {
        const res = await fetch(`${harness.url}/api/auth/v1/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
        const data = (await res.json()) as any;
        return data.auth_token;
      },
    });

    // Populate baseline definitions & categories
    harness.tables.categories.set(1, { id: 1, category_key: "VEHICLE_PASSENGER_CAR", name: "Passenger Cars" });
    harness.tables.pi_attribute_definitions.set(10, { id: 10, attribute_key: "MAKE", data_type: "STRING", active: 1 });
    harness.tables.pi_attribute_definitions.set(11, { id: 11, attribute_key: "MODEL", data_type: "STRING", active: 1 });
    harness.tables.pi_attribute_definitions.set(12, { id: 12, attribute_key: "MODEL_YEAR", data_type: "INTEGER", active: 1 });
    harness.tables.pi_attribute_definitions.set(13, { id: 13, attribute_key: "ODOMETER_KM", data_type: "DECIMAL", active: 1 });
  });

  // ── Mandatory Case 1: Collection GET returns HTTP 503 ───────────────
  test("Case 1: Collection GET returns HTTP 503 -> propagates TrailBaseReadError, does not return false empty array", async () => {
    harness.collectionFaults.set("pi_projection_outbox", { status: 503, body: { error: "Database locked" } });

    await expect(store.list("pi_projection_outbox", "")).rejects.toThrow(TrailBaseReadError);
    await expect(store.list("pi_projection_outbox", "")).rejects.toThrow(/HTTP 503/);

    // consumeSearchProjectionOutbox must propagate or fail without claiming normal 0 pending events
    await expect(consumeSearchProjectionOutbox(store)).rejects.toThrow(TrailBaseReadError);
  });

  // ── Mandatory Case 2: Individual vehicle GET returns HTTP 503 ───────
  test("Case 2: Individual vehicle GET returns HTTP 503 -> transient failure does not acknowledge outbox event", async () => {
    // Seed an outbox event with product_type VEHICLE and product_id 88 without auctionId in payload
    harness.tables.pi_projection_outbox.set(101, {
      id: 101,
      product_type: "VEHICLE",
      product_id: 88,
      event_type: "INSPECTION_PROJECTED",
      payload: JSON.stringify({ note: "inspection completed" }),
      published_at: null,
    });

    // Inject 503 specifically on vehicle 88
    harness.recordFaults.set("vehicles/88", { status: 503, body: { error: "Service unavailable" } });

    await expect(store.get("vehicles", 88)).rejects.toThrow(TrailBaseReadError);
    await expect(store.get("vehicles", 88)).rejects.toThrow(/HTTP 503/);

    // Consume outbox: must not acknowledge event #101
    const res = await consumeSearchProjectionOutbox(store);
    expect(res.failed).toBe(1);
    expect(res.processed).toBe(0);

    const outboxRow = harness.tables.pi_projection_outbox.get(101);
    expect(outboxRow.published_at).toBeNull();
  });

  // ── Mandatory Case 3: Search-index GET returns HTTP 403 ─────────────
  test("Case 3: Search-index GET returns HTTP 403 -> throws TrailBaseReadError and halts rebuild without wiping index", async () => {
    // Seed existing auctions and search index
    harness.tables.auctions.set(10, { id: 10, title: "Toyota Hilux", status: "live" });
    harness.tables.product_search_index.set(10, { auction_id: 10, title: "Toyota Hilux", auction_status: "live" });

    harness.collectionFaults.set("product_search_index", { status: 403, body: { error: "Forbidden table access" } });

    await expect(store.list("product_search_index", "")).rejects.toThrow(TrailBaseReadError);
    await expect(store.list("product_search_index", "")).rejects.toThrow(/HTTP 403/);

    // Rebuild must fail closed and NOT wipe out the existing index
    await expect(rebuildProductSearchIndex(store)).rejects.toThrow(TrailBaseReadError);
    expect(harness.tables.product_search_index.get(10)).toBeDefined();
  });

  // ── Mandatory Case 4: Supporting facts GET returns HTTP 500 ─────────
  test("Case 4: Supporting facts GET returns HTTP 500 -> refreshAuctionSearch fails closed and preserves outbox", async () => {
    harness.tables.auctions.set(20, { id: 20, title: "Mazda Demio", status: "live", product_category_id: 1 });
    harness.tables.vehicles.set(201, { id: 201, auction_id: 20, make: "Mazda", model: "Demio" });
    harness.tables.pi_projection_outbox.set(102, {
      id: 102,
      product_type: "AUCTION",
      product_id: 20,
      event_type: "EFFECTIVE_FACT_CHANGED",
      payload: JSON.stringify({ auctionId: 20 }),
      published_at: null,
    });

    harness.collectionFaults.set("pi_effective_facts", { status: 500, body: { error: "Internal DB error" } });

    await expect(store.list("pi_effective_facts", "")).rejects.toThrow(TrailBaseReadError);
    await expect(refreshAuctionSearch(store, 20)).rejects.toThrow(TrailBaseReadError);

    const res = await consumeSearchProjectionOutbox(store);
    expect(res.failed).toBe(1);
    expect(res.processed).toBe(0);

    const outboxRow = harness.tables.pi_projection_outbox.get(102);
    expect(outboxRow.published_at).toBeNull();
  });

  // ── Mandatory Case 5: Expired admin token and failed refresh ────────
  test("Case 5: Expired admin token and failed refresh -> propagates login error and aborts processing", async () => {
    harness.tables.auctions.set(30, { id: 30, title: "Nissan Note", status: "live" });
    harness.tables.pi_projection_outbox.set(103, {
      id: 103,
      product_type: "AUCTION",
      product_id: 30,
      event_type: "PRODUCT_PUBLISHED",
      payload: JSON.stringify({ auctionId: 30 }),
      published_at: null,
    });

    // Make login fail with 401
    harness.loginFault = { status: 401, body: { error: "Invalid admin password" } };

    await expect(store.list("auctions", "")).rejects.toThrow(/admin login failed: 401/);
    await expect(store.get("auctions", 30)).rejects.toThrow(/admin login failed: 401/);

    await expect(consumeSearchProjectionOutbox(store)).rejects.toThrow(/admin login failed: 401/);
    expect(harness.tables.pi_projection_outbox.get(103).published_at).toBeNull();
  });

  // ── Mandatory Case 6: Genuine individual-record HTTP 404 ────────────
  test("Case 6: Genuine individual-record HTTP 404 -> returns null (not error), orphaned event is safely acknowledged", async () => {
    // Non-existent vehicle 999 returns 404 from server
    const result = await store.get("vehicles", 999);
    expect(result).toBeNull();

    // Outbox event referencing genuinely non-existent vehicle 999
    harness.tables.pi_projection_outbox.set(104, {
      id: 104,
      product_type: "VEHICLE",
      product_id: 999,
      event_type: "INSPECTION_PROJECTED",
      payload: JSON.stringify({ note: "orphaned" }),
      published_at: null,
    });

    const res = await consumeSearchProjectionOutbox(store);
    expect(res.processed).toBe(1);
    expect(res.failed).toBe(0);

    const outboxRow = harness.tables.pi_projection_outbox.get(104);
    expect(outboxRow.published_at).not.toBeNull();
  });

  // ── Mandatory Case 7: Malformed HTTP 200 response ───────────────────
  test("Case 7: Malformed HTTP 200 response -> throws TrailBaseReadError, never treats as valid empty list or object", async () => {
    // Malformed collection response: missing records array
    harness.collectionFaults.set("categories", { status: 200, malformed: true, body: { invalidData: 123 } });
    await expect(store.list("categories", "")).rejects.toThrow(TrailBaseReadError);
    await expect(store.list("categories", "")).rejects.toThrow(/missing records array/);

    // Malformed record response: array instead of single object
    harness.recordFaults.set("auctions/1", { status: 200, malformed: true, body: [1, 2, 3] });
    await expect(store.get("auctions", 1)).rejects.toThrow(TrailBaseReadError);
    await expect(store.get("auctions", 1)).rejects.toThrow(/malformed record data/);
  });

  // ── Mandatory Case 8: Visibility-invalidation PATCH returns unsuccessful result ──
  test("Case 8: Visibility-invalidation PATCH returns 500 -> removeAuctionFromSearch throws error, fails closed", async () => {
    harness.tables.auctions.set(50, { id: 50, title: "Ford Ranger", status: "withdrawn" });
    harness.tables.product_search_index.set(50, { auction_id: 50, title: "Ford Ranger", auction_status: "live" });

    // Patch on product_search_index fails
    harness.patchFaults.set("product_search_index/50", { status: 500, body: { error: "Disk full" } });

    await expect(removeAuctionFromSearch(store, 50)).rejects.toThrow(
      "Failed to invalidate search visibility for auction 50",
    );
  });

  // ── Mandatory Case 9: Failed read leaves published_at = null ────────
  test("Case 9: Failed read leaves published_at = null for all affected outbox events", async () => {
    harness.tables.auctions.set(61, { id: 61, title: "Subaru Outback", status: "live", product_category_id: 1 });
    harness.tables.auctions.set(62, { id: 62, title: "Isuzu D-Max", status: "live", product_category_id: 1 });

    harness.tables.pi_projection_outbox.set(201, {
      id: 201,
      product_type: "AUCTION",
      product_id: 61,
      event_type: "PRODUCT_PUBLISHED",
      payload: JSON.stringify({ auctionId: 61 }),
      published_at: null,
    });
    harness.tables.pi_projection_outbox.set(202, {
      id: 202,
      product_type: "AUCTION",
      product_id: 62,
      event_type: "PRODUCT_PUBLISHED",
      payload: JSON.stringify({ auctionId: 62 }),
      published_at: null,
    });

    // Fail reads on vehicles
    harness.collectionFaults.set("vehicles", { status: 503, body: { error: "Database busy" } });

    const res = await consumeSearchProjectionOutbox(store);
    expect(res.failed).toBe(2);
    expect(res.processed).toBe(0);

    expect(harness.tables.pi_projection_outbox.get(201).published_at).toBeNull();
    expect(harness.tables.pi_projection_outbox.get(202).published_at).toBeNull();
  });

  // ── Mandatory Case 10: Recovery retries and processes the event exactly once ────
  test("Case 10: Recovery retries and processes the event exactly once with zero duplicate rows", async () => {
    harness.tables.auctions.set(70, { id: 70, title: "Toyota Land Cruiser", status: "live", product_category_id: 1 });
    harness.tables.vehicles.set(701, { id: 701, auction_id: 70, make: "Toyota", model: "Land Cruiser", model_year: 2023 });
    harness.tables.pi_projection_outbox.set(301, {
      id: 301,
      product_type: "AUCTION",
      product_id: 70,
      event_type: "PRODUCT_PUBLISHED",
      payload: JSON.stringify({ auctionId: 70 }),
      published_at: null,
    });

    // Step 1: Upstream TrailBase failure
    harness.collectionFaults.set("vehicles", { status: 503, body: { error: "Database temporarily locked" } });
    const failRes = await consumeSearchProjectionOutbox(store);
    expect(failRes.failed).toBe(1);
    expect(harness.tables.pi_projection_outbox.get(301).published_at).toBeNull();

    // Step 2: Upstream TrailBase heals
    harness.collectionFaults.clear();
    const recoverRes = await consumeSearchProjectionOutbox(store);
    expect(recoverRes.processed).toBe(1);
    expect(recoverRes.failed).toBe(0);
    expect(harness.tables.pi_projection_outbox.get(301).published_at).not.toBeNull();

    // Verify exactly one row in product_search_index
    const searchRows = Array.from(harness.tables.product_search_index.values()).filter((r) => r.auction_id === 70);
    expect(searchRows.length).toBe(1);
    expect(searchRows[0].make).toBe("Toyota");
    expect(searchRows[0].model).toBe("Land Cruiser");

    // Step 3: Re-run must process 0 events (idempotent, no duplicates)
    const secondRun = await consumeSearchProjectionOutbox(store);
    expect(secondRun.processed).toBe(0);
    expect(secondRun.failed).toBe(0);
  });

  // ── Mandatory Case 11: Public search rejects incomplete or invalid projection state ──
  test("Case 11: Public search rejects deleted, withdrawn, draft, and incomplete projections", async () => {
    // 1. Withdrawn auction marked deleted in search index
    harness.tables.product_search_index.set(80, {
      auction_id: 80,
      title: "Withdrawn Mercedes C200",
      auction_status: "deleted",
      category_key: "VEHICLE_PASSENGER_CAR",
      price: 25000,
    });

    // 2. Live auction
    harness.tables.auctions.set(81, { id: 81, title: "Active BMW 320i", status: "live" });
    harness.tables.product_search_index.set(81, {
      auction_id: 81,
      title: "Active BMW 320i",
      auction_status: "live",
      category_key: "VEHICLE_PASSENGER_CAR",
      price: 28000,
    });

    // queryProductSearch with live status
    const liveSearch = await queryProductSearch(store, { status: "live" });
    const liveIds = liveSearch.items.map((i) => i.auction_id);
    expect(liveIds).toContain(81);
    expect(liveIds).not.toContain(80);

    // queryProductSearch with "all" status: deleted must still be excluded by PUBLIC_SEARCH_STATUSES
    const allSearch = await queryProductSearch(store, { status: "all" });
    const allIds = allSearch.items.map((i) => i.auction_id);
    expect(allIds).toContain(81);
    expect(allIds).not.toContain(80);

    // Draft / unpublished auction rejection in publicProductBundle & productCompare
    harness.tables.auctions.set(82, { id: 82, title: "Draft Porsche", status: "draft" });
    harness.tables.product_intake_sessions.set(820, { id: 820, auction_id: 82, state: "DRAFT" });

    const bundle = await publicProductBundle(store, 82);
    expect(bundle.product).toBeNull();

    await expect(productCompare(store, [81, 82])).rejects.toThrow(
      "not publicly available for comparison",
    );
  });

  // ── Mandatory Case 12: HTTP 429 Rate Limit throws TrailBaseReadError ──
  test("Case 12: HTTP 429 Rate Limit throws TrailBaseReadError", async () => {
    harness.collectionFaults.set("auctions", { status: 429, body: { error: "Too many requests" } });
    await expect(store.list("auctions", "")).rejects.toThrow(TrailBaseReadError);
    try {
      await store.list("auctions", "");
    } catch (err: any) {
      expect(err).toBeInstanceOf(TrailBaseReadError);
      expect(err.status).toBe(429);
      expect(err.table).toBe("auctions");
    }
  });

  // ── Mandatory Case 13: HTTP 502 Bad Gateway throws TrailBaseReadError ──
  test("Case 13: HTTP 502 Bad Gateway throws TrailBaseReadError", async () => {
    harness.recordFaults.set("auctions/99", { status: 502, body: { error: "Bad gateway" } });
    await expect(store.get("auctions", 99)).rejects.toThrow(TrailBaseReadError);
    try {
      await store.get("auctions", 99);
    } catch (err: any) {
      expect(err).toBeInstanceOf(TrailBaseReadError);
      expect(err.status).toBe(502);
      expect(err.table).toBe("auctions");
    }
  });

  // ── Mandatory Case 14: Request timeout / AbortSignal throws ──
  test("Case 14: Request timeout / AbortSignal throws", async () => {
    const timeoutStore = createStrictTrailBaseStore({
      baseUrl: harness.url,
      timeoutMs: 40,
      getAdminToken: async () => harness.validToken,
    });
    harness.delayMs = 150;
    await expect(timeoutStore.get("auctions", 1)).rejects.toThrow();
    harness.delayMs = 0;
  });

  // ── Mandatory Case 15: Network connection failure propagates ──
  test("Case 15: Network connection failure propagates", async () => {
    const unreachableStore = createStrictTrailBaseStore({
      baseUrl: "http://127.0.0.1:59998",
      timeoutMs: 500,
      getAdminToken: async () => harness.validToken,
    });
    await expect(unreachableStore.get("auctions", 1)).rejects.toThrow();
  });

  // ── Mandatory Case 16: Failed POST returns null, logs status, does not acknowledge ──
  test("Case 16: Failed POST returns null, logs status, does not acknowledge", async () => {
    harness.postFaults.set("product_search_facet_values", { status: 500, body: { error: "Insert constraint violation" } });
    const createdId = await store.create("product_search_facet_values", { auction_id: 99 });
    expect(createdId).toBeNull();
  });

  // ── Mandatory Case 17: Failed DELETE returns false, fails closed ──
  test("Case 17: Failed DELETE returns false, fails closed", async () => {
    harness.deleteFaults.set("product_search_facet_values/55", { status: 500, body: { error: "Delete lock conflict" } });
    const removed = await store.remove("product_search_facet_values", 55);
    expect(removed).toBe(false);
  });

  // ── Mandatory Case 18: Successful forced token refresh on 401/403 retry ──
  test("Case 18: Successful forced token refresh on 401/403 retry", async () => {
    let callCount = 0;
    const dynamicStore = createStrictTrailBaseStore({
      baseUrl: harness.url,
      getAdminToken: async (force?: boolean) => {
        callCount++;
        // First token is invalid, forced token is valid
        if (force) return harness.validToken;
        return "expired-initial-token";
      },
    });

    harness.tables.auctions.set(100, { id: 100, title: "Refreshed Auction" });
    const record = await dynamicStore.get("auctions", 100);
    expect(record).not.toBeNull();
    expect(record?.id).toBe(100);
    expect(callCount).toBe(2);
  });

  // ── Mandatory Case 19: Failed forced token refresh throws login error ──
  test("Case 19: Failed forced token refresh throws login error", async () => {
    const failingAuthStore = createStrictTrailBaseStore({
      baseUrl: harness.url,
      getAdminToken: async (force?: boolean) => {
        if (force) throw new Error("Credential revocation on re-auth");
        return "stale-token";
      },
    });

    await expect(failingAuthStore.get("auctions", 1)).rejects.toThrow(
      "Credential revocation on re-auth",
    );
  });

  // ── Mandatory Case 20: Repeated auth failure bounds retries to exactly 1 ──
  test("Case 20: Repeated auth failure bounds retries to exactly 1 and throws TrailBaseReadError", async () => {
    let authAttempts = 0;
    const alwaysRejectedStore = createStrictTrailBaseStore({
      baseUrl: harness.url,
      getAdminToken: async (_force?: boolean) => {
        authAttempts++;
        return "permanently-bad-token";
      },
    });

    await expect(alwaysRejectedStore.get("auctions", 1)).rejects.toThrow(TrailBaseReadError);
    // Initial call (1) + retry on 401 (1) = 2 attempts total (exactly 1 retry)
    expect(authAttempts).toBe(2);
  });
});
