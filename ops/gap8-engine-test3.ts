// Gap-8 verification round 3: create listing as rufaro → feature it; room lot lifecycle with simba bidding.
import { io } from "socket.io-client";
const TB = "http://localhost:3001";
async function tbLogin(u: string, p: string) {
  const res = await fetch(`${TB}/api/auth/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
  return (await res.json()).auth_token;
}
function rpc(s: any, event: string, data: Record<string, unknown>) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 12000);
    s.emit(event, data, (res: any) => { clearTimeout(t); resolve(res); });
  });
}
const rufaro = await tbLogin("rufaro", "Tengasell#2025");
const s = io("http://localhost:3002", { auth: { token: rufaro }, transports: ["websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));
const me = (await (await fetch(`${TB}/api/records/v1/profiles?filter[username][$eq]=rufaro&limit=1`)).json()).records[0];
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// create a fresh live listing as rufaro (offers enabled for later UI testing)
const cats = (await (await fetch(`${TB}/api/records/v1/categories?limit=50`)).json()).records;
const cat = cats[0]?.slug ?? "electronics";
const createRes = await fetch(`${TB}/api/records/v1/auctions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${rufaro}` },
  body: JSON.stringify({
    user: me.user, seller_username: "rufaro", title: "Gap-8 Test: Solar Inverter 5kVA (offers + live-room demo)",
    slug: "gap8-test-solar-inverter-5kva", description: "Fresh listing created to verify Gap-8 engine flows end to end. Hybrid inverter, barely used.",
    category: cat, condition: "like-new", start_price: 150, current_price: 150, buy_now_price: 400,
    reserve_price: null, bid_count: 0, watch_count: 0, views: 0, shipping_fee: 10, shipping: "nationwide",
    city: "Harare", ends_at: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(), started_at: now,
    status: "live", extension_count: 0, featured: 0, allow_offers: 1, offer_min: 100,
    images: JSON.stringify([]), created_at: now, updated_at: now,
  }),
});
const created = await createRes.json();
const newId = Number(created.ids?.[0] ?? 0);
console.log("created auction", newId, "ok:", createRes.ok);

// feature it
const f = await rpc(s, "listing:feature", { auctionId: newId });
console.log("listing:feature →", f.ok, (f as any).error ?? "featured!");
const again = await rpc(s, "listing:feature", { auctionId: newId });
console.log("double feature rejected →", again.ok === false);

// room lifecycle: add lot, open, simba bids, hammer
const sess = (await (await fetch(`${TB}/api/records/v1/live_sessions?filter[status][$eq]=scheduled&limit=1`)).json()).records[0];
console.log("session:", sess?.id, sess?.title);
const add = await rpc(s, "room:add-lot", { sessionId: sess.id, auctionId: newId });
console.log("room:add-lot →", add.ok, (add as any).error ?? "");
const open = await rpc(s, "host:open-lot", { sessionId: sess.id });
console.log("host:open-lot →", open.ok, "status=" + (open as any).session?.status, "lot=" + (open as any).session?.current_lot_id);

// simba joins and bids on the open lot
const simbaToken = await tbLogin("simba", "Tengasell#2025");
const s2 = io("http://localhost:3002", { auth: { token: simbaToken }, transports: ["websocket"] });
await new Promise<void>((r) => s2.on("connect", () => r()));
const bid = await rpc(s2, "bid:place", { auctionId: newId, maxAmount: 200 });
console.log("simba bid on live lot →", bid.ok, "amount=" + (bid as any).amount);
const sess2 = (await (await fetch(`${TB}/api/records/v1/live_sessions/${sess.id}`)).json());
console.log("hammer close_at set:", sess2.close_at != null ? new Date(sess2.close_at).toISOString() : "NO", "| now:", new Date().toISOString());
// host hammers it now (sold=true)
const hammer = await rpc(s, "host:close-lot", { sessionId: sess.id, sold: true });
console.log("host:close-lot sold →", hammer.ok, (hammer as any).error ?? "");
const { records: orders } = await (await fetch(`${TB}/api/records/v1/orders?filter[auction_id][$eq]=${newId}&limit=5`)).json();
console.log("order created:", orders.length > 0, "buyer=" + orders[0]?.buyer_username, "price=" + orders[0]?.final_price, "status=" + orders[0]?.status);
const sessAfter = (await (await fetch(`${TB}/api/records/v1/live_sessions/${sess.id}`)).json());
console.log("session after hammer: status=" + sessAfter.status, "currentLot=" + sessAfter.current_lot_id, "(no more lots → closed)");
const auctionAfter = (await (await fetch(`${TB}/api/records/v1/auctions/${newId}`)).json());
console.log("auction after hammer: status=" + auctionAfter.status, "featured=" + auctionAfter.featured);
s.disconnect(); s2.disconnect();
process.exit(0);
