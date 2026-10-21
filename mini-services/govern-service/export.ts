// export.ts — DSAR export bundle builder (PRV-005/008: access + portability).
//
// Pulls the data subject's records from TrailBase with the ADMIN token (the
// ACL-scoped user token can't fan out across every collection) and combines
// them with the user's govern-side records. Scope is HONEST: the manifest
// lists exactly what is included, and comms-service data (channel links,
// delivery logs, campaign membership) is noted as available through its own
// admin console rather than silently omitted.

import { all } from "./db";
import { tbList } from "./trailbase";
import { APP_URL } from "./config";

export interface ExportSection {
  count: number;
  note?: string;
  records?: unknown[];
}

export interface ExportBundle {
  manifest: {
    subject: string;
    generated_at: string;
    format: "application/json";
    purpose: string;
    scope: string[];
    scope_notes: string[];
    retention_note: string;
    authority: string;
    app_url: string;
  };
  profile: ExportSection;
  listings: ExportSection;
  bids: ExportSection;
  orders_as_buyer: ExportSection;
  orders_as_seller: ExportSection;
  payments: ExportSection;
  ratings_given: ExportSection;
  ratings_received: ExportSection;
  watchlist: ExportSection;
  threads: ExportSection;
  messages: ExportSection;
  questions: ExportSection;
  notifications: ExportSection;
  governance: ExportSection;
}

interface GovRequestRow {
  id: number; type: string; status: string; created_at: string; due_at: string;
  completed_at: string | null; result_note: string | null;
}

function section(records: unknown[], note?: string): ExportSection {
  return { count: records.length, records, ...(note ? { note } : {}) };
}

export async function buildExportBundle(username: string): Promise<ExportBundle> {
  const generatedAt = new Date().toISOString();

  // 1. profile (gives us the encrypted user ref for ref-keyed tables)
  const profiles = await tbList("profiles", { username }, 5);
  const profile = profiles[0] ?? null;
  const userRef = typeof profile?.user === "string" ? (profile.user as string) : null;

  // 2. fan-out (each guarded — tbList never throws)
  const [listings, bids, ordersBuyer, ordersSeller, payments, ratingsGiven, ratingsReceived,
    watchlist, threadsBuyer, threadsSeller, questions, notifications] = await Promise.all([
    tbList("auctions", { seller_username: username }, 1000),
    tbList("bids", { bidder_username: username }, 2000),
    tbList("orders", { buyer_username: username }, 1000),
    tbList("orders", { seller_username: username }, 1000),
    userRef ? tbList("payments", { user: userRef }, 1000) : Promise.resolve([]),
    userRef ? tbList("ratings", { user: userRef }, 1000) : Promise.resolve([]),
    userRef ? tbList("ratings", { ratee_user: userRef }, 1000) : Promise.resolve([]),
    userRef ? tbList("watchlist", { user: userRef }, 1000) : Promise.resolve([]),
    tbList("threads", { buyer_username: username }, 500),
    tbList("threads", { seller_username: username }, 500),
    tbList("questions", { asker_username: username }, 1000),
    userRef ? tbList("notifications", { user: userRef }, 1000) : Promise.resolve([]),
  ]);

  // 3. messages across the subject's threads + messages they sent anywhere
  const threadIds = new Set<string>();
  for (const t of [...threadsBuyer, ...threadsSeller]) {
    if (t.id != null) threadIds.add(String(t.id));
  }
  const messageLists = await Promise.all(
    [...threadIds].slice(0, 50).map((id) => tbList("messages", { thread_id: id }, 500)),
  );
  const sentMessages = await tbList("messages", { sender_username: username }, 1000);
  const messageMap = new Map<string, unknown>();
  for (const m of [...messageLists.flat(), ...sentMessages]) {
    if (m.id != null) messageMap.set(String(m.id), m);
  }
  const messages = [...messageMap.values()];

  // 4. govern-side records
  const govRequests = all<GovRequestRow>(
    `SELECT id, type, status, created_at, due_at, completed_at, result_note
     FROM privacy_requests WHERE username = ? ORDER BY id DESC LIMIT 100`,
    [username],
  );
  const govAcceptances = all(
    `SELECT policy_key, version, accepted_at, surface FROM policy_acceptances
     WHERE username = ? ORDER BY id DESC LIMIT 200`,
    [username],
  );
  const govFlags = all(
    `SELECT flag, note, created_at, lifted_at FROM user_flags WHERE username = ?`,
    [username],
  );
  const governance = {
    count: govRequests.length + govAcceptances.length + govFlags.length,
    privacy_requests: govRequests,
    policy_acceptances: govAcceptances,
    processing_flags: govFlags,
  };

  const noProfileNote =
    "No TrailBase profile row was found for this username (never created, or already removed). Ref-keyed sections are empty as a result.";
  const threadNote =
    threadIds.size >= 50
      ? "Messages cover your 50 most recent threads."
      : undefined;

  return {
    manifest: {
      subject: username,
      generated_at: generatedAt,
      format: "application/json",
      purpose:
        "Data subject access + portability request (Cyber and Data Protection Act [Chapter 12:07] — right of access and data portability).",
      scope: [
        "profile",
        "listings",
        "bids",
        "orders (as buyer and seller)",
        "payments",
        "ratings (given and received)",
        "watchlist",
        "threads",
        "messages",
        "questions",
        "notifications",
        "governance records (privacy requests, policy acceptances, processing flags)",
      ],
      scope_notes: [
        "Your authentication account record (email, password hash) is maintained by the platform's authentication engine (TrailBase auth) and is referenced here by your profile row rather than copied; you may request account deletion through this Privacy Centre.",
        "Communications data (channel links, notification delivery logs, campaign membership) is held by the comms service and is available on request through the platform's admin console; it is not duplicated into this bundle.",
        "Financial ledger entries derived from your orders/payments are retained under tax law (7 years) and are reconciled by reference; they appear here via the orders and payments sections.",
      ],
      retention_note:
        "Some categories are retained after account deletion where the law requires: order, payment, fee and tax records (7 years, Value Added Tax Act [Chapter 23:12]); audit and security logs (12 months); dispute and moderation evidence (3 years); any active legal hold. Retained records are minimised and access-controlled.",
      authority: "Tengasell Privacy Centre — DSAR export",
      app_url: APP_URL,
    },
    profile: profile
      ? section([profile])
      : section([], noProfileNote),
    listings: section(listings),
    bids: section(bids, "Includes your confidential proxy-bid maximums — visible only to you in this export."),
    orders_as_buyer: section(ordersBuyer),
    orders_as_seller: section(ordersSeller),
    payments: section(payments),
    ratings_given: section(ratingsGiven),
    ratings_received: section(ratingsReceived),
    watchlist: section(watchlist),
    threads: section([...threadsBuyer, ...threadsSeller], threadNote),
    messages: section(messages, threadNote),
    questions: section(questions),
    notifications: section(notifications),
    governance,
  };
}
