import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.TRAILBASE_PORT ?? 3001);
const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "mini-services/trailbase-db/traildepot/migrations/main",
);

const DEFAULT_PASSWORD = process.env.TRAILBASE_TEST_PASSWORD ?? "Tengasell#2025";

function isoOffset(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

function makeJwt(payload: { sub: string; username: string; admin: boolean }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    }),
  ).toString("base64url");
  return `${header}.${body}.local-sqlite-sig`;
}

function decodeJwtPayload(token: string): { sub?: string; username?: string; admin?: boolean } {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function toBase64(val: unknown): string {
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return Buffer.from(val).toString("base64");
  }
  return String(val ?? "");
}

function serializeRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
      out[k] = Buffer.from(v).toString("base64");
    } else {
      out[k] = v;
    }
  }
  return out;
}

class LocalTrailbaseSqlite {
  db!: Database;
  tables = new Map<string, Map<string, string>>();
  revokedTokens = new Set<string>();

  constructor() {
    this.reset();
  }

  reset(): Record<string, unknown> {
    this.revokedTokens?.clear?.();
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* ignore */
      }
    }
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE _user (
        id BLOB PRIMARY KEY,
        email TEXT,
        username TEXT UNIQUE,
        password_hash TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        admin INTEGER NOT NULL DEFAULT 0
      );
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^U\d+__.*\.sql$/i.test(name))
      .sort();
    for (const file of files) {
      let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      if (file.startsWith("U1000000001__")) {
        sql = sql
          .replace(/uuid_v4\(\)/g, "randomblob(16)")
          .replace(/\(hash_password\('([^']+)'\)\)/g, "'test-hash:$1'");
      }
      try {
        db.exec(sql);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }

    // Prevent legacy U1 demo auctions (< 9000) from triggering sweepAuctions() floods during R2/R3A tests.
    db.exec("UPDATE auctions SET ends_at = '2099-12-31T23:59:59Z' WHERE id < 9000 AND status = 'live'; DELETE FROM saved_searches;");

    // Stabilize _user UUIDs deterministically across resets so cached trade-engine tokens stay valid.
    const users = db.query("SELECT rowid, username FROM _user").all() as { rowid: number; username: string }[];
    for (const u of users) {
      const detId = crypto.createHash("sha256").update(`tengasell-user:${u.username}`).digest().subarray(0, 16);
      const oldRow = db.query("SELECT id FROM _user WHERE rowid = ?").get(u.rowid) as { id: Uint8Array };
      db.query("UPDATE _user SET id = ? WHERE rowid = ?").run(detId, u.rowid);
      db.query("UPDATE profiles SET user = ? WHERE username = ?").run(detId, u.username);
      db.query("UPDATE vehicle_staff_roles SET user = ?, granted_by = ? WHERE username = ?").run(detId, detId, u.username);
      db.query("UPDATE auctions SET user = ? WHERE seller_username = ?").run(detId, u.username);
      db.query("UPDATE bids SET user = ? WHERE bidder_username = ?").run(detId, u.username);
      db.query("UPDATE questions SET user = ? WHERE asker_username = ?").run(detId, u.username);
      db.query("UPDATE threads SET buyer_user = ? WHERE buyer_username = ?").run(detId, u.username);
      db.query("UPDATE threads SET seller_user = ? WHERE seller_username = ?").run(detId, u.username);
      db.query("UPDATE messages SET user = ? WHERE sender_username = ?").run(detId, u.username);
      db.query("UPDATE orders SET buyer_user = ? WHERE buyer_username = ?").run(detId, u.username);
      db.query("UPDATE orders SET seller_user = ? WHERE seller_username = ?").run(detId, u.username);
      db.query("UPDATE payments SET user = ? WHERE user = ?").run(detId, oldRow.id);
      db.query("UPDATE ratings SET user = ? WHERE user = ?").run(detId, oldRow.id);
      db.query("UPDATE ratings SET ratee_user = ? WHERE ratee_username = ?").run(detId, u.username);
      db.query("UPDATE notifications SET user = ? WHERE user = ?").run(detId, oldRow.id);
    }

    this.db = db;
    this.introspect();
    return this.seedRuntime();
  }

  private introspect() {
    this.tables.clear();
    const objs = this.db
      .query(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string; type: string }[];

    for (const obj of objs) {
      const cols = new Map<string, string>();
      const info = this.db.query(`PRAGMA table_info("${obj.name}")`).all() as {
        name: string;
        type: string;
      }[];
      for (const c of info) {
        cols.set(c.name, (c.type || "").toUpperCase());
      }
      this.tables.set(obj.name, cols);
    }

    // Views like auction_public don't preserve declared types via PRAGMA table_info;
    // mirror column declared types from their base table so BLOB filters decode base64 properly.
    const auctionsCols = this.tables.get("auctions");
    const auctionPublicCols = this.tables.get("auction_public");
    if (auctionsCols && auctionPublicCols) {
      for (const [col, t] of auctionPublicCols.entries()) {
        if (!t && auctionsCols.has(col)) {
          auctionPublicCols.set(col, auctionsCols.get(col) || "");
        }
      }
    }
  }

  private getUserBlob(username: string): Uint8Array {
    const row = this.db
      .query("SELECT id FROM _user WHERE LOWER(username) = LOWER(?) LIMIT 1")
      .get(username) as { id: Uint8Array } | null;
    if (!row) throw new Error(`Seed user not found: ${username}`);
    return row.id;
  }

  private seedRuntime(): Record<string, unknown> {
    const db = this.db;
    const adminId = this.getUserBlob("admin");
    const sellerId = this.getUserBlob("takudzwa");
    const nyashaId = this.getUserBlob("nyasha");
    const simbaId = this.getUserBlob("simba");
    const rufaroId = this.getUserBlob("rufaro");
    const now = isoOffset(0);

    // 1. Venue
    db.query(
      `INSERT INTO auction_venues (id, name, address, city, country, timezone, venue_type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      900,
      "Harare Borrowdale Auction Arena",
      "14 Sam Levy Boulevard, Borrowdale",
      "Harare",
      "Zimbabwe",
      "Africa/Harare",
      "HYBRID",
      adminId,
      now,
      now,
    );

    // 2. Whole-vehicle auctions must be inserted as status='draft' per trg_vehicle_auction_create_gate,
    // then upgraded to 'live' only after eligible vehicle intelligence rows exist.
    const vehicleSpecs = [
      {
        auctionId: 9101,
        vehicleId: 9201,
        inspId: 9301,
        title: "2021 Toyota Hilux Double Cab 2.8 GD-6 4x4",
        slug: "2021-toyota-hilux-28-gd6-4x4-9101",
        desc: "Verified executive fleet bakkie with complete service records and 160-point Tengasell inspection.",
        startPrice: 28000,
        currentPrice: 29500,
        reservePrice: null as number | null,
        reserveDisclosure: "NO_RESERVE",
        vin: "JTEBH3FJ00K910101",
        reg: "AFD-9101",
        make: "Toyota",
        model: "Hilux",
        variant: "2.8 GD-6 Raider 4x4",
        year: 2021,
        cc: 2755,
        fuel: "DIESEL",
        trans: "AUTOMATIC",
        drive: "4WD",
        odo: 68400,
        city: "Harare",
        grade: "A",
        score: 94,
        images: JSON.stringify([
          "https://images.unsplash.com/photo-1559416523-140ddc3d238c?auto=format&fit=crop&w=1000&q=80",
          "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1000&q=80",
        ]),
        endsAt: isoOffset(3 * 3600_000),
      },
      {
        auctionId: 9102,
        vehicleId: 9202,
        inspId: 9302,
        title: "2020 Isuzu D-Max 3.0 TD X-Rider Auto",
        slug: "2020-isuzu-dmax-xrider-9102",
        desc: "Clean double cab prepared for Lot 2 on the Harare live floor.",
        startPrice: 22000,
        currentPrice: 22000,
        reservePrice: 24000,
        reserveDisclosure: "RESERVE_APPLIES",
        vin: "MPATFS85JLT910202",
        reg: "AFE-9102",
        make: "Isuzu",
        model: "D-Max",
        variant: "3.0 TD X-Rider",
        year: 2020,
        cc: 2999,
        fuel: "DIESEL",
        trans: "AUTOMATIC",
        drive: "4WD",
        odo: 81200,
        city: "Harare",
        grade: "B",
        score: 86,
        images: JSON.stringify([
          "https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1000&q=80",
        ]),
        endsAt: isoOffset(4 * 3600_000),
      },
      {
        auctionId: 9103,
        vehicleId: 9203,
        inspId: 9303,
        title: "2019 Nissan NP300 Hardbody 2.5 TDi 4x4",
        slug: "2019-nissan-np300-hardbody-9103",
        desc: "Commercial fleet unit queued as Lot 3.",
        startPrice: 15500,
        currentPrice: 15500,
        reservePrice: null,
        reserveDisclosure: "NO_RESERVE",
        vin: "ADNCDUD22Z0910303",
        reg: "AFF-9103",
        make: "Nissan",
        model: "NP300 Hardbody",
        variant: "2.5 TDi Hi-Rider",
        year: 2019,
        cc: 2488,
        fuel: "DIESEL",
        trans: "MANUAL",
        drive: "4WD",
        odo: 112000,
        city: "Bulawayo",
        grade: "B",
        score: 82,
        images: JSON.stringify([
          "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1000&q=80",
        ]),
        endsAt: isoOffset(5 * 3600_000),
      },
      {
        auctionId: 9104,
        vehicleId: 9204,
        inspId: 9304,
        title: "2022 Honda Fit e:HEV Hybrid",
        slug: "2022-honda-fit-ehev-9104",
        desc: "Upcoming scheduled event Lot 1 unit.",
        startPrice: 11000,
        currentPrice: 11000,
        reservePrice: null,
        reserveDisclosure: "NO_RESERVE",
        vin: "JHMGR3850NS910404",
        reg: "AFG-9104",
        make: "Honda",
        model: "Fit",
        variant: "e:HEV Home",
        year: 2022,
        cc: 1498,
        fuel: "HYBRID",
        trans: "CVT",
        drive: "FWD",
        odo: 34500,
        city: "Harare",
        grade: "A",
        score: 93,
        images: JSON.stringify([
          "https://images.unsplash.com/photo-1549317661-bd82c83f22b3?auto=format&fit=crop&w=1000&q=80",
        ]),
        endsAt: isoOffset(12 * 3600_000),
      },
      {
        auctionId: 9105,
        vehicleId: 9205,
        inspId: 9305,
        title: "2020 Subaru Forester 2.0i-L EyeSight AWD",
        slug: "2020-subaru-forester-awd-9105",
        desc: "Timed auction SUV open for individual bids without joining an event floor.",
        startPrice: 17500,
        currentPrice: 18400,
        reservePrice: null,
        reserveDisclosure: "NO_RESERVE",
        vin: "JF2SK9KC5LG910505",
        reg: "AFH-9105",
        make: "Subaru",
        model: "Forester",
        variant: "2.0i-L EyeSight",
        year: 2020,
        cc: 1995,
        fuel: "PETROL",
        trans: "CVT",
        drive: "AWD",
        odo: 54000,
        city: "Harare",
        grade: "A",
        score: 91,
        images: JSON.stringify([
          "https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1000&q=80",
        ]),
        endsAt: isoOffset(24 * 3600_000),
      },
    ];

    for (const v of vehicleSpecs) {
      db.query(
        `INSERT INTO auctions (
          id, user, seller_username, title, slug, description, category, condition,
          start_price, current_price, buy_now_price, reserve_price,
          bid_count, watch_count, views, shipping_fee, shipping, city,
          ends_at, started_at, status, extension_count, featured, images,
          created_at, updated_at, asset_kind, reserve_disclosure, owner_bid_right_disclosure, commercial_policy_ready
        ) VALUES (?, ?, ?, ?, ?, ?, 'vehicles', 'used', ?, ?, NULL, ?, 0, 12, 64, 0, 'pickup', ?, ?, ?, 'draft', 0, 1, ?, ?, ?, 'vehicle', ?, 'NOT_PERMITTED', 1)`,
      ).run(
        v.auctionId,
        sellerId,
        "takudzwa",
        v.title,
        v.slug,
        v.desc,
        v.startPrice,
        v.currentPrice,
        v.reservePrice,
        v.city,
        v.endsAt,
        isoOffset(-7200_000),
        v.images,
        now,
        now,
        v.reserveDisclosure,
      );

      db.query(
        `INSERT INTO vehicles (
          id, auction_id, seller_user, seller_username, vin, registration_number,
          make, model, variant, model_year, engine_displacement_cc, fuel_type,
          transmission, drivetrain, odometer_km, location_city, location_country,
          ownership_status, customs_status, requested_duration_hours,
          declaration_accepted_at, lifecycle, tengasell_grade, created_at, updated_at
        ) VALUES (?, ?, ?, 'takudzwa', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Zimbabwe', 'DECLARED_OWNER', 'CLEARED', 72, ?, 'ELIGIBLE', ?, ?, ?)`,
      ).run(
        v.vehicleId,
        v.auctionId,
        sellerId,
        v.vin,
        v.reg,
        v.make,
        v.model,
        v.variant,
        v.year,
        v.cc,
        v.fuel,
        v.trans,
        v.drive,
        v.odo,
        v.city,
        now,
        v.grade,
        now,
        now,
      );

      for (const docType of ["REGISTRATION", "OWNERSHIP", "CUSTOMS_CLEARANCE"] as const) {
        db.query(
          `INSERT INTO vehicle_documents (
            vehicle_id, document_type, document_ref, issuer, issued_at, status,
            uploaded_by, verified_by, verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'ZIMRA / CVR', '2025-01-15T00:00:00Z', 'VERIFIED', ?, ?, ?, ?, ?)`,
        ).run(
          v.vehicleId,
          docType,
          `${docType}-${v.reg}`,
          sellerId,
          adminId,
          now,
          now,
          now,
        );
      }

      db.query(
        `INSERT INTO vehicle_inspections (
          id, vehicle_id, version, inspector_user, inspector_name, reviewer_user, reviewer_name,
          lifecycle, odometer_km, roadworthy, notes, grade_score, grade, submitted_at, reviewed_at, created_at, updated_at
        ) VALUES (?, ?, 1, ?, 'admin', ?, 'admin', 'REVIEWED', ?, 1, 'Clean 160-point Tengasell inspection passed; roadworthy.', ?, ?, ?, ?, ?, ?)`,
      ).run(
        v.inspId,
        v.vehicleId,
        adminId,
        adminId,
        v.odo,
        v.score,
        v.grade,
        now,
        now,
        now,
        now,
      );

      db.query(
        `INSERT INTO vehicle_inspection_findings (
          inspection_id, category, component, location, severity, description,
          repair_recommended, safety_critical, created_by, created_at
        ) VALUES (?, 'BODY', 'Rear bumper trim', 'Rear right', 'MINOR', 'Light polish mark on bumper corner; no structural impact.', 0, 0, ?, ?)`,
      ).run(v.inspId, adminId, now);

      db.query(
        `INSERT INTO vehicle_eligibility (
          vehicle_id, inspection_id, version, status, decided_by, decided_at, created_at
        ) VALUES (?, ?, 1, 'ELIGIBLE', ?, ?, ?)`,
      ).run(v.vehicleId, v.inspId, adminId, now, now);

      // Now activate to live (trg_vehicle_auction_live_gate passes)
      db.query(`UPDATE auctions SET status = 'live', updated_at = ? WHERE id = ?`).run(
        now,
        v.auctionId,
      );
    }

    // Seed an opening bid from nyasha on Lot 1 (9101) so initial floor state shows live activity
    // and simba can outbid nyasha in real-time tests, OR keep Lot 1 cleanly at start_price until live bid?
    // Wait: keeping 9101 with 0 bids initially or 1 bid by nyasha at 29500 lets scenarios test both cleanly.
    // Let's reset 9101 current_price = 28000 (bid_count = 0) so Nyasha's first bid + Simba's counter-bid are completely clean!
    db.query(`UPDATE auctions SET current_price = 28000, bid_count = 0 WHERE id = 9101`).run();

    // 3. Auction events (trg_auction_event_create_session auto-creates live_sessions when session_id IS NULL)
    db.query(
      `INSERT INTO auction_events (
        id, host_user, host_username, title, description, venue_id, session_id,
        starts_at, ends_at, timezone, status, version, run_list_version, run_list_locked,
        created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, 900, NULL, ?, ?, 'Africa/Harare', 'SCHEDULED', 0, 0, 0, ?, ?)`,
    ).run(
      901,
      adminId,
      "Harare Executive & Utility Fleet Live Auction",
      "Flagship Harare live auction event featuring verified 4x4 commercial and executive vehicles.",
      isoOffset(-30 * 60_000),
      isoOffset(3 * 3600_000),
      now,
      now,
    );

    const ev901 = db.query("SELECT session_id FROM auction_events WHERE id = 901").get() as {
      session_id: number;
    };
    const s901Id = Number(ev901.session_id);

    // Insert 3 lots on Event 901: Lot 1 LIVE (9101), Lot 2 READY (9102), Lot 3 QUEUED (9103)
    db.query(
      `INSERT INTO auction_lots (
        id, event_id, session_id, auction_id, sequence_no, status, version,
        original_ends_at, original_live_session_id, ready_at, opened_at, created_by, created_at, updated_at
      ) VALUES
        (9401, 901, ?, 9101, 1, 'LIVE',   2, ?, NULL, ?, ?, ?, ?, ?),
        (9402, 901, ?, 9102, 2, 'READY',  1, ?, NULL, ?, NULL, ?, ?, ?),
        (9403, 901, ?, 9103, 3, 'QUEUED', 0, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      s901Id,
      isoOffset(3 * 3600_000),
      now,
      now,
      adminId,
      now,
      now,
      s901Id,
      isoOffset(4 * 3600_000),
      now,
      adminId,
      now,
      now,
      s901Id,
      isoOffset(5 * 3600_000),
      adminId,
      now,
      now,
    );

    db.query(
      `UPDATE auction_events
          SET status = 'LIVE', run_list_locked = 1, run_list_version = 4,
              current_lot_id = 9401, next_lot_id = 9402, updated_at = ?
        WHERE id = 901`,
    ).run(now);

    db.query(
      `UPDATE live_sessions
          SET status = 'live', current_lot_id = 9101, next_lot_id = 9102,
              lot_index = 1, run_list_version = 4, run_list_locked = 1,
              close_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(isoOffset(180_000), now, s901Id);

    db.query(`UPDATE auctions SET live_session_id = ? WHERE id IN (9101, 9102, 9103)`).run(
      s901Id,
    );

    // Scheduled Event 902 (awaiting start)
    db.query(
      `INSERT INTO auction_events (
        id, host_user, host_username, title, description, venue_id, session_id,
        starts_at, ends_at, timezone, status, version, run_list_version, run_list_locked,
        created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, 900, NULL, ?, ?, 'Africa/Harare', 'SCHEDULED', 0, 0, 0, ?, ?)`,
    ).run(
      902,
      adminId,
      "Weekend Hybrid & Passenger Showcase",
      "Scheduled upcoming showcase opening Saturday afternoon.",
      isoOffset(4 * 3600_000),
      isoOffset(7 * 3600_000),
      now,
      now,
    );
    const ev902 = db.query("SELECT session_id FROM auction_events WHERE id = 902").get() as {
      session_id: number;
    };
    const s902Id = Number(ev902.session_id);

    db.query(
      `INSERT INTO auction_lots (
        id, event_id, session_id, auction_id, sequence_no, status, version,
        original_ends_at, original_live_session_id, ready_at, created_by, created_at, updated_at
      ) VALUES (9404, 902, ?, 9104, 1, 'READY', 1, ?, NULL, ?, ?, ?, ?)`,
    ).run(s902Id, isoOffset(12 * 3600_000), now, adminId, now, now);
    db.query(`UPDATE auction_events SET next_lot_id = 9404 WHERE id = 902`).run();
    db.query(`UPDATE live_sessions SET next_lot_id = 9104 WHERE id = ?`).run(s902Id);
    db.query(`UPDATE auctions SET live_session_id = ? WHERE id = 9104`).run(s902Id);

    // Cancelled Event 903
    db.query(
      `INSERT INTO auction_events (
        id, host_user, host_username, title, description, venue_id, session_id,
        starts_at, ends_at, timezone, status, version, run_list_version, run_list_locked,
        created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, 900, NULL, ?, ?, 'Africa/Harare', 'CANCELLED', 0, 0, 0, ?, ?)`,
    ).run(
      903,
      adminId,
      "Bulawayo Cancelled Plant Sale",
      "Cancelled fixture event.",
      isoOffset(24 * 3600_000),
      isoOffset(28 * 3600_000),
      now,
      now,
    );

    // 4. Bidder qualifications for Event 901 via canonical trigger
    for (const bidder of [
      { id: nyashaId, username: "nyasha", limit: 50000 },
      { id: simbaId, username: "simba", limit: 50000 },
    ]) {
      db.query(
        `INSERT INTO auction_qualification_commands (
          command_key, event_id, target_user, target_username,
          actor_user, actor_username, actor_admin, command_type,
          qualification_basis, approved_limit, account_state, risk_state,
          deposit_state, deposit_amount, credit_state, credit_limit
        ) VALUES (?, 901, ?, ?, ?, 'admin', 1, 'APPROVE', 'DEPOSIT_VERIFIED', ?, 'ELIGIBLE', 'CLEAR', 'HELD', 5000, 'NONE', 0)`,
      ).run(`seed-qual-901-${bidder.username}`, bidder.id, bidder.username, adminId, bidder.limit);
    }

    return {
      events: [901, 902, 903],
      sessions: { live901: s901Id, scheduled902: s902Id },
      auctions: { lot1: 9101, lot2: 9102, lot3: 9103, lot4Scheduled: 9104, timedVehicle: 9105 },
      actors: {
        host: "admin",
        seller: "takudzwa",
        qualifiedBuyers: ["nyasha", "simba"],
        unqualifiedBuyer: "rufaro",
        rufaroHasNoQual:
          db
            .query("SELECT id FROM auction_bidder_qualifications WHERE event_id = 901 AND user = ?")
            .get(rufaroId) == null,
      },
    };
  }

  private convertParam(table: string, col: string, raw: unknown): unknown {
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) return raw;
    const colType = this.tables.get(table)?.get(col) ?? "";
    if (colType.includes("BLOB") && typeof raw === "string") {
      if (/^[0-9a-f]{32}$/i.test(raw)) return Buffer.from(raw, "hex");
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length >= 16) {
        return Buffer.from(raw, "base64");
      }
      return Buffer.from(raw, "utf8");
    }
    if ((colType.includes("INT") || colType.includes("REAL")) && typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    }
    if (typeof raw === "boolean") return raw ? 1 : 0;
    return raw;
  }

  private resolveBearerUser(req: Request): { id: Uint8Array; username: string; admin: boolean } | null {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token || this.revokedTokens.has(token)) return null;
    const payload = decodeJwtPayload(token);
    if (!payload.username) return null;
    const row = this.db
      .query("SELECT id, username, admin FROM _user WHERE LOWER(username) = LOWER(?) LIMIT 1")
      .get(payload.username) as { id: Uint8Array; username: string; admin: number } | null;
    if (!row) return null;
    return { id: row.id, username: row.username, admin: Boolean(row.admin) };
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: corsHeaders });

    if (pathname === "/__test/reset" && req.method === "POST") {
      const summary = this.reset();
      return json({ ok: true, summary });
    }
    if (pathname === "/__test/state" && req.method === "GET") {
      return json({
        ok: true,
        events: this.db.query("SELECT id, title, status, session_id, current_lot_id, next_lot_id, run_list_version FROM auction_events ORDER BY id").all(),
        lots: this.db.query("SELECT id, event_id, auction_id, sequence_no, status FROM auction_lots ORDER BY event_id, sequence_no").all(),
        auctions: this.db.query("SELECT id, title, status, current_price, bid_count, live_session_id FROM auctions WHERE id >= 9100 ORDER BY id").all(),
      });
    }

    // Auth endpoints
    if (pathname === "/api/auth/v1/login" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { username?: string; email?: string; password?: string };
      const ident = String(body.username ?? body.email ?? "").trim();
      const pw = String(body.password ?? "");
      const user = this.db
        .query("SELECT id, username, password_hash, admin FROM _user WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1")
        .get(ident, ident) as { id: Uint8Array; username: string; password_hash: string; admin: number } | null;
      const validPw = pw === DEFAULT_PASSWORD || (user && user.password_hash === `test-hash:${pw}`);
      if (!user || !validPw) {
        return json({ error: "Invalid credentials" }, 401);
      }
      const token = makeJwt({
        sub: toBase64(user.id),
        username: user.username,
        admin: Boolean(user.admin),
      });
      return json({ auth_token: token });
    }

    if (pathname === "/api/auth/v1/status" && req.method === "GET") {
      const user = this.resolveBearerUser(req);
      if (!user) return json({ error: "Unauthorized" }, 401);
      const auth = req.headers.get("authorization")!.replace(/^Bearer\s+/i, "").trim();
      return json({ auth_token: auth });
    }

    if (pathname === "/api/auth/v1/logout" && req.method === "POST") {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (token) this.revokedTokens.add(token);
      return json({ ok: true });
    }

    if (pathname === "/__test/revoke" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { token?: string };
      if (body.token) this.revokedTokens.add(body.token);
      return json({ ok: true, revoked: body.token });
    }

    // Records endpoints
    const recMatch = pathname.match(/^\/api\/records\/v1\/([A-Za-z0-9_]+)(?:\/([^/]+))?$/);
    if (!recMatch) {
      return json({ error: "Not found" }, 404);
    }

    const table = recMatch[1];
    const idParam = recMatch[2];
    const cols = this.tables.get(table);
    if (!cols) {
      return json({ error: `Unknown table: ${table}` }, 404);
    }

    // Single record endpoints
    if (idParam !== undefined) {
      if (req.method === "GET") {
        const row = this.db
          .query(`SELECT * FROM "${table}" WHERE id = ? LIMIT 1`)
          .get(this.convertParam(table, "id", idParam) as never) as Record<string, unknown> | null;
        if (!row) return json({ error: "Not found" }, 404);
        return json(serializeRow(row));
      }

      if (req.method === "PATCH") {
        const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const entries = Object.entries(patch).filter(([k]) => cols.has(k) && k !== "id");
        if (entries.length === 0) return json({ ok: true });
        const setSql = entries.map(([k]) => `"${k}" = ?`).join(", ");
        const values = entries.map(([k, v]) => this.convertParam(table, k, v));
        try {
          this.db
            .query(`UPDATE "${table}" SET ${setSql} WHERE id = ?`)
            .run(...(values as never[]), this.convertParam(table, "id", idParam) as never);
          return json({ ok: true });
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
      }

      if (req.method === "DELETE") {
        this.db
          .query(`DELETE FROM "${table}" WHERE id = ?`)
          .run(this.convertParam(table, "id", idParam) as never);
        return new Response(null, { status: 204, headers: corsHeaders });
      }
    }

    // Collection GET
    if (req.method === "GET") {
      const whereParts: string[] = [];
      const whereValues: unknown[] = [];

      for (const [key, value] of url.searchParams.entries()) {
        const m = key.match(/^filter\[([^\]]+)\]\[(\$[a-z]+)\]$/);
        if (!m) continue;
        const [, col, op] = m;
        if (!cols.has(col)) continue;

        if (op === "$eq") {
          if (value === "null") {
            whereParts.push(`"${col}" IS NULL`);
          } else {
            whereParts.push(`"${col}" = ?`);
            whereValues.push(this.convertParam(table, col, value));
          }
        } else if (op === "$ne") {
          whereParts.push(`"${col}" != ?`);
          whereValues.push(this.convertParam(table, col, value));
        } else if (op === "$gt") {
          whereParts.push(`"${col}" > ?`);
          whereValues.push(this.convertParam(table, col, value));
        } else if (op === "$gte") {
          whereParts.push(`"${col}" >= ?`);
          whereValues.push(this.convertParam(table, col, value));
        } else if (op === "$lt") {
          whereParts.push(`"${col}" < ?`);
          whereValues.push(this.convertParam(table, col, value));
        } else if (op === "$lte") {
          whereParts.push(`"${col}" <= ?`);
          whereValues.push(this.convertParam(table, col, value));
        } else if (op === "$like") {
          whereParts.push(`"${col}" LIKE ?`);
          whereValues.push(value);
        } else if (op === "$is") {
          if (value.toLowerCase() === "null") whereParts.push(`"${col}" IS NULL`);
          else if (value.toLowerCase() === "notnull") whereParts.push(`"${col}" IS NOT NULL`);
        } else if (op === "$in") {
          const items = value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (items.length) {
            whereParts.push(`"${col}" IN (${items.map(() => "?").join(", ")})`);
            for (const it of items) whereValues.push(this.convertParam(table, col, it));
          }
        }
      }

      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const rawOrder = url.searchParams.get("order") ?? "";
      let orderSql = "";
      if (rawOrder) {
        const orderClauses = rawOrder
          .split(",")
          .map((part) => part.trim())
          .map((part) => {
            const desc = part.startsWith("-");
            const colName = desc ? part.slice(1) : part;
            if (!cols.has(colName)) return null;
            return `"${colName}" ${desc ? "DESC" : "ASC"}`;
          })
          .filter(Boolean);
        if (orderClauses.length) orderSql = `ORDER BY ${orderClauses.join(", ")}`;
      }

      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") ?? 100) || 100));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

      const rows = this.db
        .query(`SELECT * FROM "${table}" ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
        .all(...(whereValues as never[]), limit, offset) as Record<string, unknown>[];
      const countRow = this.db
        .query(`SELECT COUNT(*) AS cnt FROM "${table}" ${whereSql}`)
        .get(...(whereValues as never[])) as { cnt: number };

      return json({
        records: rows.map((r) => serializeRow(r)),
        total_count: Number(countRow?.cnt ?? rows.length),
      });
    }

    // Collection POST
    if (req.method === "POST") {
      const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (table === "profiles" && !payload.user) {
        const bearer = this.resolveBearerUser(req);
        if (bearer) payload.user = bearer.id;
      }
      const entries = Object.entries(payload).filter(([k]) => cols.has(k));
      if (entries.length === 0) {
        return json({ error: "No valid columns provided" }, 400);
      }
      const colNames = entries.map(([k]) => `"${k}"`).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const values = entries.map(([k, v]) => this.convertParam(table, k, v));
      try {
        const res = this.db
          .query(`INSERT INTO "${table}" (${colNames}) VALUES (${placeholders})`)
          .run(...(values as never[]));
        return json({ ids: [Number(res.lastInsertRowid)] }, 201);
      } catch (err) {
        return json({ error: (err as Error).message }, 400);
      }
    }

    return json({ error: "Method not allowed" }, 405);
  }
}

const store = new LocalTrailbaseSqlite();
const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req) {
    return store.handle(req);
  },
});

console.log(`[local-trailbase-sqlite] listening on http://127.0.0.1:${server.port}`);
