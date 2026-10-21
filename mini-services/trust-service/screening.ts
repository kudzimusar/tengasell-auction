// Listing screening (MKT-008/029, CTL-017 listing queue, TNS-003):
// scan live TrailBase auctions (title + description) against the
// screening_rules patterns (case-insensitive regex), record hits in
// screening_hits, and expose the takedown action (GOV-010): PATCH the auction
// to status "ended" (the exact field/status the trade engine uses for ended
// auctions) + notify buyers (orders on the auction), watchers (watchlist
// rows) and the seller, recording every notice in notifications_log.

import { get, insert, run, scalar, all } from "./db";
import { nowIso } from "./util";
import { userNotice } from "./notify";
import { audit, getRecords, updateRecord } from "./trailbase";
import { HttpError } from "./http";

export interface ScanSummary {
  scanned: number;
  newHits: number;
  totalPending: number;
}

/** Run a screening scan over every LIVE auction (the takedown-able set). */
export async function runScan(): Promise<ScanSummary> {
  const rules = all<
    { id: number; pattern: string; category: "prohibited" | "caution"; note: string }
  >(`SELECT id, pattern, category, note FROM screening_rules WHERE active = 1`);
  const compiled = rules
    .map((r) => {
      try {
        return { ...r, re: new RegExp(r.pattern, "i") };
      } catch {
        console.warn(`[trust] bad screening pattern #${r.id}: ${r.pattern}`);
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const auctions = await getRecords("auctions", `filter[status][$eq]=live&limit=500`);
  let newHits = 0;
  for (const a of auctions) {
    const text = `${a.title ?? ""} ${a.description ?? ""}`;
    for (const rule of compiled) {
      if (!rule.re.test(text)) continue;
      const auctionId = Number(a.id);
      const already = scalar(
        `SELECT COUNT(*) AS n FROM screening_hits WHERE auction_id = ? AND rule_id = ? AND status IN('pending','actioned')`,
        [auctionId, rule.id],
      );
      if (already > 0) continue;
      insert(
        `INSERT INTO screening_hits(auction_id, rule_id, pattern, status, created_at) VALUES(?,?,?, 'pending', ?)`,
        [auctionId, rule.id, rule.pattern, nowIso()],
      );
      newHits++;
    }
  }
  return {
    scanned: auctions.length,
    newHits,
    totalPending: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'pending'`),
  };
}

/**
 * Takedown (GOV-010): end the auction, notify every buyer (user with an
 * order on the auction), every watcher and the seller. Returns the
 * notification evidence count.
 */
export async function takedownListing(auctionId: number, actor: string): Promise<{
  ended: boolean;
  notified: number;
  audience: string[];
}> {
  const auction = await getRecords("auctions", `filter[id][$eq]=${auctionId}&limit=1`).then((r) => r[0]);
  if (!auction) throw new HttpError(404, "auction not found", "not_found");

  const title = String(auction.title ?? `Auction #${auctionId}`);
  const seller = String(auction.seller_username ?? "");

  // 1. End the auction — same PATCH shape the trade engine uses
  //    ({status: "ended", updated_at}) when auctions time out unsold.
  const ended = await updateRecord("auctions", auctionId, {
    status: "ended",
    updated_at: nowIso(),
  });

  // 2. Collect the notification audience: distinct buyers on orders for this
  //    auction + watchers + the seller.
  const audience = new Set<string>();
  if (seller) audience.add(seller);
  const orders = await getRecords("orders", `filter[auction_id][$eq]=${auctionId}&limit=200`);
  for (const o of orders) {
    const buyer = String(o.buyer_username ?? "");
    if (buyer) audience.add(buyer);
  }
  const watchRows = await getRecords("watchlist", `filter[auction_id][$eq]=${auctionId}&limit=500`);
  for (const w of watchRows) {
    // watchlist rows key by TrailBase user UUID — resolve via profiles.
    const uid = String(w.user ?? "");
    if (!uid) continue;
    const profiles = await getRecords(
      "profiles",
      `filter[user][$eq]=${encodeURIComponent(uid)}&limit=1`,
    );
    const name = String(profiles[0]?.username ?? "");
    if (name) audience.add(name);
  }

  const body = `The listing "${title}" was removed by Tengasell Trust & Safety for violating our Marketplace Rules (prohibited/restricted items). If you were watching, bidding on, or had ordered this item, our support team can help — open a ticket from My Tengasell → Support.`;

  let notified = 0;
  for (const username of audience) {
    await userNotice({
      username,
      eventKey: "trust.takedown",
      title: "Listing removed by Trust & Safety",
      body,
      link: "help",
      viaComms: true,
    });
    notified++;
  }

  await audit(actor, "screening.takedown", "auctions", auctionId, "trust", {
    title,
    seller,
    notified,
  });
  return { ended, notified, audience: [...audience] };
}

/** Mark a hit cleared (false positive) — audit-logged. */
export function clearHit(hitId: number, actor: string): void {
  const hit = get(`SELECT * FROM screening_hits WHERE id = ?`, [hitId]);
  if (!hit) throw new HttpError(404, "screening hit not found", "not_found");
  run(`UPDATE screening_hits SET status = 'cleared', reviewer = ?, resolved_at = ? WHERE id = ?`, [
    actor,
    nowIso(),
    hitId,
  ]);
  void audit(actor, "screening.clear", "screening_hits", hitId, "trust", {
    auction_id: (hit as { auction_id: number }).auction_id,
  });
}
