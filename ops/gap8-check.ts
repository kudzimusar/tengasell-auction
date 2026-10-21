const TB = "http://localhost:3001";
const res = await fetch(`${TB}/api/auth/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "Tengasell#2025" }) });
const token = (await res.json()).auth_token;
const auth = { Authorization: `Bearer ${token}` };
const orders = (await (await fetch(`${TB}/api/records/v1/orders?order=-id&limit=3`, { headers: auth })).json()).records;
console.log("latest orders:", orders.map((o: any) => `#${o.id} a=${o.auction_id} buyer=${o.buyer_username} price=${o.final_price} status=${o.status} pay_by=${o.pay_by}`).join(" | "));
const auc = await (await fetch(`${TB}/api/records/v1/auctions/2005`)).json();
console.log("auction 2005:", "status=" + auc.status, "featured=" + auc.featured, "allow_offers=" + auc.allow_offers, "live_session_id=" + auc.live_session_id);
const sessions = (await (await fetch(`${TB}/api/records/v1/live_sessions?limit=5`, { headers: auth })).json()).records;
console.log("sessions:", sessions.map((x: any) => `#${x.id} ${x.title} status=${x.status} lot=${x.current_lot_id}`).join(" | "));
const notifs = (await (await fetch(`${TB}/api/records/v1/notifications?limit=6`, { headers: auth })).json()).records;
console.log("recent notif types:", notifs.map((n: any) => n.type + "/" + n.title).slice(0, 6).join(" | "));
// check finance ledger for featured fee
const fin = await fetch("http://localhost:3006/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "listing.featured", auctionId: 2005, seller: "rufaro" }) });
console.log("finance idempotency (repeat charge on 2005):", JSON.stringify(await fin.json()));
