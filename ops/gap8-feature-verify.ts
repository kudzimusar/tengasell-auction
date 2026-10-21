// Clean the probe charge, then feature auction 2005 properly via engine RPC.
import { io } from "socket.io-client";
import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/db/finance.db");
const n = db.run("DELETE FROM ledger_entries WHERE balanced_tx = 'feat-2005'");
console.log("probe ledger rows removed:", n.changes);
db.run("DELETE FROM events_log WHERE type='listing.featured'");
db.run("UPDATE seller_balances SET available_cents = available_cents + 230 WHERE username = 'rufaro'");
db.close();

const TB = "http://localhost:3001";
const res = await fetch(`${TB}/api/auth/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "rufaro", password: "Tengasell#2025" }) });
const token = (await res.json()).auth_token;
const s = io("http://localhost:3002", { auth: { token }, transports: ["websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));
const rpc = (event: string, data: Record<string, unknown>) =>
  new Promise((resolve) => { const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 12000); s.emit(event, data, (r2: any) => { clearTimeout(t); resolve(r2); }); });

// 2005 is sold now (hammer test) — feature only works on live. Create ANOTHER listing to verify.
const me = (await (await fetch(`${TB}/api/records/v1/profiles?filter[username][$eq]=rufaro&limit=1`)).json()).records[0];
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const createRes = await fetch(`${TB}/api/records/v1/auctions`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    user: me.user, seller_username: "rufaro", title: "Gap-8 Verify: Kingstar Generator 3kVA (offers on)",
    slug: "gap8-verify-kingstar-generator-3kva", description: "Featured-fee verification listing. Runs perfectly, serviced last month.",
    category: "solar-power", condition: "used", start_price: 220, current_price: 220, buy_now_price: null,
    reserve_price: null, bid_count: 0, watch_count: 0, views: 0, shipping_fee: 15, shipping: "nationwide",
    city: "Bulawayo", ends_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(), started_at: now,
    status: "live", extension_count: 0, featured: 0, allow_offers: 1, offer_min: 150,
    images: JSON.stringify([]), created_at: now, updated_at: now,
  }),
});
const created = await createRes.json();
const id = Number(created.ids?.[0] ?? 0);
console.log("new listing:", id);
const f = await rpc("listing:feature", { auctionId: id });
console.log("listing:feature →", f.ok, (f as any).error ?? "FEATURED");
const auc = await (await fetch(`${TB}/api/records/v1/auctions/${id}`)).json();
console.log("auction after:", "status=" + auc.status, "featured=" + auc.featured);
const again = await rpc("listing:feature", { auctionId: id });
console.log("double-charge rejected →", again.ok === false, "|", (again as any).error);
// idempotency: repeated finance event does NOT double-charge
const fin = await fetch("http://localhost:3006/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "listing.featured", auctionId: id, seller: "rufaro" }) });
console.log("finance repeat on same id:", JSON.stringify(await fin.json()));
const db2 = new Database("/home/z/my-project/db/finance.db", { readonly: true });
const rows = db2.query("SELECT amount_cents, direction FROM ledger_entries WHERE balanced_tx = ?").all(`feat-${id}`);
console.log("ledger legs for feat-" + id + ":", JSON.stringify(rows));
db2.close();
s.disconnect();
process.exit(0);
