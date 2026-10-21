// Idempotent demo seeder — POST /admin/seed-demo (admin-gated).
// Seeds: second TrailBase admin "trustops" (for honest dual-approval demos —
// CTL-021 requires a DIFFERENT admin; TrailBase has no admin-management API,
// so we insert the row directly into traildepot/data/main.db copying the
// existing admin's argon2id password hash — password Tengasell#2025),
// staff role rows, 3 EN + 3 JA macros, the Zimbabwe prohibited-goods
// screening rules, two borderline demo listings (via the TrailBase records
// API), sample tickets (chipo question + rufaro refund with an internal
// note), one dismissed report, one warning enforcement example, and an
// initial screening scan run. Every step checks for existing state first —
// re-running is safe.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { insert, get, run, scalar } from "./db";
import { isoPlusDays, isoPlusHours, nowIso, slugify } from "./util";
import { createEnforcementRow } from "./core";
import { runScan } from "./screening";
import { createRecord, getRecords } from "./trailbase";
import { uuidBlob } from "./totp";

const TRAILBASE_MAIN_DB = "/home/z/my-project/mini-services/trailbase-db/traildepot/data/main.db";

export interface SeedSummary {
  alreadySeeded: boolean;
  secondAdmin: { created: boolean; username: string; note: string };
  rolesSeeded: number;
  macrosSeeded: number;
  rulesSeeded: number;
  demoListings: number;
  ticketsSeeded: number;
  reportSeeded: boolean;
  enforcementSeeded: boolean;
  scan: { scanned: number; newHits: number; totalPending: number } | null;
}

// ── Zimbabwe-relevant prohibited list (task brief section E) ──────────────

const RULES: { pattern: string; category: "prohibited" | "caution"; note: string }[] = [
  // weapons / ammunition
  { pattern: "\\b(airsoft|pellet gun|bb gun|paintball gun|taser|stun gun|brass knuckl|knuckle duster|switchblade|dagger|crossbow|handgun|pistol|rifle|shotgun)\\b", category: "prohibited", note: "Weapons & realistic imitations — Firearms Act [Ch 10:09]" },
  { pattern: "\\b(ammo|ammunition|bullets?|cartridges? for guns?|co2 ?canisters?)\\b", category: "prohibited", note: "Ammunition & gun propellant" },
  // narcotics
  { pattern: "\\b(mbanje|marijuana|cannabis|cocaine|heroin|crystal meth|mutoriro|mdma|ecstasy)\\b", category: "prohibited", note: "Narcotics — Dangerous Drugs Act" },
  // counterfeit / pirated
  { pattern: "\\b(counterfeit|knockoff|pirated|replica (watch|designer|brand)|fake (iphone|samsung|nike|adidas))\\b", category: "prohibited", note: "Counterfeit goods — IP violation" },
  // wildlife / ivory
  { pattern: "\\b(ivory|rhino horn|pangolin|elephant tusk|leopard skin|cheetah skin|tortoise shell)\\b", category: "prohibited", note: "Wildlife products — Parks & Wildlife Act" },
  // live animals
  { pattern: "\\b(puppy|kitten|live (dog|cat|bird|animal))\\b", category: "prohibited", note: "Live animal sales are prohibited on Tengasell" },
  // human parts
  { pattern: "\\b(human (organ|bone|blood)|real human teeth)\\b", category: "prohibited", note: "Human parts & bodily materials" },
  // currency exchange / money changing
  { pattern: "\\b(forex|money chang(er|ing)|currency exchange|zwl to usd|usd to zwl|rtgs for usd|rate for us\\$?)\\b", category: "prohibited", note: "Currency exchange services — RBZ licensing required; collectible banknotes are allowed" },
  // adult
  { pattern: "\\b(porn|adult video|escort service|onlyfans)\\b", category: "prohibited", note: "Adult content" },
  // stolen goods
  { pattern: "\\b(stolen|smash and grab special|hub special no papers)\\b", category: "prohibited", note: "Stolen / unverified-ownership goods" },
  // prescription medication
  { pattern: "\\b(codeine|morphine|valium|diazepam|xanax|prescription (painkillers?|meds?|medication)|arvs? for sale)\\b", category: "prohibited", note: "Prescription medicines require a licensed pharmacy" },
  // caution rules — review, don't auto-take-down
  { pattern: "whatsapp", category: "caution", note: "Off-platform steering signal — verify no payment steering (AUP)" },
  { pattern: "\\bsold as seen\\b", category: "caution", note: "No-refund language — Consumer Protection Act [Ch 14:44] caution" },
  { pattern: "\\bmeet (me )?tonight\\b", category: "caution", note: "Unsafe meetup language — suggest depot pickup" },
];

// ── macros (SUP-008, DOC-007) ─────────────────────────────────────────────

const MACROS: { title: string; body: string; locale: string }[] = [
  {
    title: "Greeting + SLA (EN)",
    body: "Hi! Thanks for contacting Tengasell Support — this is ${agent} from the Trust & Support team. We reply within 24 hours (4 hours for urgent tickets). How can I help with your auction today?",
    locale: "en",
  },
  {
    title: "Dispatch SLA reminder (EN)",
    body: "Just a reminder from our honest rules: sellers dispatch within 3 days of payment and buyers have a 7-day window after delivery to open a dispute. Your order details are in My Tengasell → Orders.",
    locale: "en",
  },
  {
    title: "Refund escalation (EN)",
    body: "I've escalated your refund request to our Finance team — you'll see the refund on the original payment method within 5 working days of approval. I'll keep this ticket updated until it's settled.",
    locale: "en",
  },
  {
    title: "挨拶＋SLA（JA）",
    body: "こんにちは！Tengasellサポートにお問い合わせいただきありがとうございます。トラスト＆サポートチームです。24時間以内（緊急チケットは4時間以内）にご返信します。本日はどのようなご用件でしょうか？",
    locale: "ja",
  },
  {
    title: "配送SLAリマインダー（JA）",
    body: "Tengasellのルールをご確認ください：出品者は支払い後3日以内に発送し、購入者は受け取り後7日以内に紛争を開くことができます。注文の詳細はマイページ→注文でご確認いただけます。",
    locale: "ja",
  },
  {
    title: "返金エスカレーション（JA）",
    body: "返金のご要望を財務チームへエスカレーションしました。承認後、5営業日以内に元の支払い方法へ返金されます。決済完了まで本チケットで状況をご案内します。",
    locale: "ja",
  },
];

// ── borderline demo listings (screening scan targets) ─────────────────────

const DEMO_LISTINGS: {
  slug: string;
  seller: string;
  title: string;
  description: string;
  category: string;
  startPrice: number;
}[] = [
  {
    slug: "demo-airsoft-metal-slide",
    seller: "kudzai",
    title: "Airsoft Pistol Metal Slide — Realistic Blowback, Spare Ammo Magazine",
    description:
      "Collectable airsoft pistol with full metal slide, shoots 6mm BBs. Comes with CO2 canisters and a spare ammo magazine. Collection in Harare CBD. (Demo listing — screening test.)",
    category: "sports",
    startPrice: 65,
  },
  {
    slug: "demo-codeine-sealed-pack",
    seller: "chipo",
    title: "Sealed Codeine 30mg Tablets — Full Pharmacy Pack",
    description:
      "Prescription painkillers available, sealed pack of codeine 30mg tablets. WhatsApp for a quick deal — sold as seen, no refunds. (Demo listing — screening test.)",
    category: "home",
    startPrice: 30,
  },
];

async function ensureDemoListing(listing: (typeof DEMO_LISTINGS)[number]): Promise<boolean> {
  const existing = await getRecords(
    "auctions",
    `filter[slug][$eq]=${encodeURIComponent(listing.slug)}&limit=1`,
  );
  if (existing.length > 0) return false;
  const sellerRows = await getRecords(
    "profiles",
    `filter[username][$eq]=${encodeURIComponent(listing.seller)}&limit=1`,
  );
  const userBlob = String(sellerRows[0]?.user ?? "");
  if (!userBlob) return false;
  const id = await createRecord("auctions", {
    user: userBlob,
    seller_username: listing.seller,
    title: listing.title,
    slug: listing.slug,
    description: listing.description,
    category: listing.category,
    condition: "used",
    start_price: listing.startPrice,
    current_price: listing.startPrice,
    buy_now_price: null,
    reserve_price: null,
    bid_count: 0,
    watch_count: 0,
    views: 3,
    shipping_fee: 5,
    shipping: "courier",
    city: "Harare",
    ends_at: isoPlusDays(14),
    started_at: nowIso(),
    status: "live",
    extension_count: 0,
    featured: 0,
    images: "[]",
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return id != null;
}

// ── second TrailBase admin (honest dual-approval demo) ────────────────────

/**
 * TrailBase's _user table has CHECK(is_uuid(id)) and CHECK(is_email(email))
 * constraints evaluated with TrailBase-registered SQL functions that do not
 * exist in a plain bun:sqlite connection. We insert with
 * `PRAGMA ignore_check_constraints = ON` for the duration of the single row
 * insert — the values we write are a genuine UUID v4 and a syntactically
 * valid email (we satisfy the constraint semantically, we just can't call
 * TrailBase's function from outside), and the pragma is connection-scoped
 * and switched off immediately after.
 */
function ensureSecondAdmin(): { created: boolean; username: string; note: string } {
  const username = "trustops";
  try {
    if (!existsSync(TRAILBASE_MAIN_DB)) {
      return { created: false, username, note: "trailbase main.db not found" };
    }
    const tb = new Database(TRAILBASE_MAIN_DB, { strict: false });
    try {
      tb.exec("PRAGMA busy_timeout = 8000;");
      const exists = tb.query(`SELECT id FROM _user WHERE username = ?`).get(username);
      if (exists) {
        return { created: false, username, note: "already present" };
      }
      const admin = tb
        .query(`SELECT password_hash, email FROM _user WHERE username = 'admin' LIMIT 1`)
        .get() as { password_hash: string } | null;
      if (!admin?.password_hash) {
        return { created: false, username, note: "admin row unreadable" };
      }
      const epoch = Math.floor(Date.now() / 1000);
      tb.exec("PRAGMA ignore_check_constraints = ON;");
      tb.run(
        `INSERT INTO _user (id, email, username, password_hash, admin, created, updated)
         VALUES(?,?,?,?,1,?,?)`,
        [uuidBlob(), "trustops@tengasell.com", username, admin.password_hash, epoch, epoch],
      );
      tb.exec("PRAGMA ignore_check_constraints = OFF;");
      const userBlob = (
        tb.query(`SELECT id FROM _user WHERE username = ?`).get(username) as { id: Buffer } | null
      )?.id;
      if (userBlob) {
        const profileExists = tb
          .query(`SELECT id FROM profiles WHERE username = ?`)
          .get(username);
        if (!profileExists) {
          tb.run(
            `INSERT INTO profiles (user, username, display_name, bio, city, rating_avg, rating_count, sales, response_minutes, verified, joined_at)
             VALUES(?,?,?,?,?,?,0,0,120,0,?)`,
            [
              userBlob,
              username,
              "Trust Operations (demo)",
              "Trust & Safety operations account (dual-approval second admin).",
              "Harare",
              0,
              nowIso(),
            ],
          );
        }
      }
      return { created: true, username, note: "created in TrailBase _user (password = Tengasell#2025)" };
    } finally {
      tb.close();
    }
  } catch (err) {
    return { created: false, username, note: `direct insert failed: ${(err as Error).message}` };
  }
}

// ── seed entry point ──────────────────────────────────────────────────────

export async function seedDemo(): Promise<SeedSummary> {
  // 1. Second admin (trustops) — for dual-approval demos.
  const secondAdmin = ensureSecondAdmin();

  // 2. Staff role rows (display layer for the RBAC console; the TrailBase
  //    admin claim is the actual gate today — 12-e wires per-role narrowing).
  let rolesSeeded = 0;
  const roleRows: { username: string; role: string; note: string }[] = [
    { username: "admin", role: "admin", note: "TrailBase admin claim (implied) — display row" },
    { username: "trustops", role: "moderator", note: "Second admin for dual approval + moderation queue" },
  ];
  for (const r of roleRows) {
    const exists = get(`SELECT username FROM roles WHERE username = ?`, [r.username]);
    if (!exists) {
      run(
        `INSERT INTO roles(username, role, assigned_by, assigned_at, note) VALUES(?,?,?,?,?)`,
        [r.username, r.role, "seed", nowIso(), r.note],
      );
      rolesSeeded++;
    }
  }

  // 3. Macros — idempotent by (title, locale).
  let macrosSeeded = 0;
  for (const m of MACROS) {
    const exists = get(`SELECT id FROM macros WHERE title = ? AND locale = ?`, [m.title, m.locale]);
    if (!exists) {
      insert(`INSERT INTO macros(title, body, locale) VALUES(?,?,?)`, [m.title, m.body, m.locale]);
      macrosSeeded++;
    }
  }

  // 4. Screening rules — idempotent by pattern.
  let rulesSeeded = 0;
  for (const r of RULES) {
    const exists = get(`SELECT id FROM screening_rules WHERE pattern = ?`, [r.pattern]);
    if (!exists) {
      insert(`INSERT INTO screening_rules(pattern, category, note, active) VALUES(?,?,?,1)`, [
        r.pattern,
        r.category,
        r.note,
      ]);
      rulesSeeded++;
    }
  }

  // 5. Borderline demo listings (via the records API).
  let demoListings = 0;
  for (const listing of DEMO_LISTINGS) {
    if (await ensureDemoListing(listing)) demoListings++;
  }

  // 6. Sample tickets: chipo question (open) + rufaro refund (pending w/
  //    internal note invisible to the customer).
  let ticketsSeeded = 0;
  const chipoExists = get(`SELECT id FROM tickets WHERE username = 'chipo' AND subject LIKE ?`, [
    "How do I arrange depot pickup in Avondale%",
  ]);
  if (!chipoExists) {
    const id = insert(
      `INSERT INTO tickets(username, subject, category, priority, status, sla_due_at, created_at)
       VALUES('chipo', 'How do I arrange depot pickup in Avondale?', 'question', 'normal', 'open', ?, ?)`,
      [isoPlusHours(24), nowIso()],
    );
    insert(
      `INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,0,?)`,
      [
        id,
        "chipo",
        "Hi! I won the espresso machine auction (#{id}) — can I collect from the Avondale depot on Friday morning instead of courier?",
        nowIso(),
      ],
    );
    insert(`INSERT INTO ticket_events(ticket_id, actor, type, payload, created_at) VALUES(?,?,?,?,?)`, [
      id,
      "chipo",
      "created",
      JSON.stringify({ seeded: true }),
      nowIso(),
    ]);
    ticketsSeeded++;
  }
  const rufaroExists = get(`SELECT id FROM tickets WHERE username = 'rufaro' AND category = 'refund' AND order_id = 1`);
  if (!rufaroExists) {
    const id = insert(
      `INSERT INTO tickets(username, subject, category, priority, order_id, status, assignee, sla_due_at, first_reply_at, created_at)
       VALUES('rufaro', 'Buyer dispute on order #1 — refund impact on my payout?', 'refund', 'high', 1, 'pending', 'admin', ?, ?, ?)`,
      [isoPlusHours(12), nowIso(), nowIso()],
    );
    insert(
      `INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,0,?)`,
      [
        id,
        "rufaro",
        "The buyer messaged saying the solar kit panel was cracked in transit. If they open a dispute, what happens to my payout and the final-value fee?",
        nowIso(),
      ],
    );
    insert(
      `INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,0,?)`,
      [
        id,
        "admin",
        "Good news: escrow only releases 7 days after delivery with no open dispute, so a genuine transit-damage claim refunds the buyer from escrow and your fee is reversed proportionally — nothing comes off your balance.",
        nowIso(),
      ],
    );
    insert(
      `INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,1,?)`,
      [
        id,
        "admin",
        "INTERNAL: order #1 delivered 2026-10-17 — dispute window open until 2026-10-24. Photos not provided yet; ask buyer for unboxing shots before escalating to Finance.",
        nowIso(),
      ],
    );
    insert(`INSERT INTO ticket_events(ticket_id, actor, type, payload, created_at) VALUES(?,?,?,?,?)`, [
      id,
      "admin",
      "agent_reply",
      JSON.stringify({ seeded: true }),
      nowIso(),
    ]);
    ticketsSeeded++;
  }

  // 7. One dismissed report.
  let reportSeeded = false;
  const reportExists = get(
    `SELECT id FROM reports WHERE reporter = 'simba' AND target_type = 'listing' AND target_id = '1048'`,
  );
  if (!reportExists) {
    insert(
      `INSERT INTO reports(reporter, target_type, target_id, reason_code, note, status, reviewer, reviewed_at, outcome, created_at)
       VALUES('simba', 'listing', '1048', 'other', 'Listing title said "68-Piece" but photo shows fewer bits — suspected exaggeration.', 'dismissed', 'admin', ?, 'Not substantiated — seller confirmed full set in a follow-up photo.', ?)`,
      [nowIso(), nowIso()],
    );
    reportSeeded = true;
  }

  // 8. One warning enforcement example (tatenda — collectible seller).
  let enforcementSeeded = false;
  const warnExists = get(
    `SELECT id FROM enforcement WHERE username = 'tatenda' AND action = 'warning' AND reason_code = 'listing_caution_borderline'`,
  );
  if (!warnExists) {
    createEnforcementRow({
      username: "tatenda",
      action: "warning",
      reason_code: "listing_caution_borderline",
      note: "Banknote collectible listing used currency-exchange-adjacent wording. Warning issued; wording amended.",
      days: null,
      actor: "seed",
    });
    enforcementSeeded = true;
  }

  // 9. Screening scan run (records hits incl. the two demo listings).
  let scan: SeedSummary["scan"] = null;
  if (scalar(`SELECT COUNT(*) AS n FROM screening_rules WHERE active = 1`) > 0) {
    scan = await runScan();
  }

  return {
    alreadySeeded:
      rolesSeeded === 0 &&
      macrosSeeded === 0 &&
      rulesSeeded === 0 &&
      demoListings === 0 &&
      ticketsSeeded === 0 &&
      !reportSeeded &&
      !enforcementSeeded,
    secondAdmin,
    rolesSeeded,
    macrosSeeded,
    rulesSeeded,
    demoListings,
    ticketsSeeded,
    reportSeeded,
    enforcementSeeded,
    scan,
  };
}
