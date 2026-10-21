// Offer loop: admin counters rufaro's pending offer → rufaro accepts counter → sale.
import { io } from "socket.io-client";
const TB = "http://localhost:3001";
async function tbLogin(u: string, p: string) {
  const res = await fetch(`${TB}/api/auth/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
  return (await res.json()).auth_token;
}
const rpc = (s: any, event: string, data: Record<string, unknown>) =>
  new Promise((resolve) => { const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 12000); s.emit(event, data, (r: any) => { clearTimeout(t); resolve(r); }); });

const offers = (await (await fetch(`${TB}/api/records/v1/offers?filter[status][$eq]=pending&limit=5`)).json()).records;
console.log("pending offers:", offers.map((o: any) => `#${o.id} a=${o.auction_id} by=${o.buyer_username} $${o.amount}`).join(" | "));
const offer = offers.find((o: any) => o.buyer_username === "rufaro");
if (!offer) { console.log("no pending rufaro offer found"); process.exit(0); }

// admin counters
const adminTok = await tbLogin("admin", "Tengasell#2025");
const sa = io("http://localhost:3002", { auth: { token: adminTok }, transports: ["websocket"] });
await new Promise<void>((r) => sa.on("connect", () => r()));
const counter = await rpc(sa, "offer:respond", { offerId: offer.id, action: "counter", amount: 95, message: "Best I can do — includes courier." });
console.log("admin counter →", counter.ok, "status=" + (counter as any).offer?.status, "counter_amount=" + (counter as any).offer?.counter_amount);

// rufaro accepts the counter
const rTok = await tbLogin("rufaro", "Tengasell#2025");
const sr = io("http://localhost:3002", { auth: { token: rTok }, transports: ["websocket"] });
await new Promise<void>((r) => sr.on("connect", () => r()));
const accept = await rpc(sr, "offer:counter-respond", { offerId: offer.id, accept: true });
console.log("buyer accept counter →", accept.ok, "orderId=" + (accept as any).orderId, (accept as any).error ?? "");
const auc = await (await fetch(`${TB}/api/records/v1/auctions/${offer.auction_id}`)).json();
console.log("auction after accept:", "status=" + auc.status);
sa.disconnect(); sr.disconnect();
process.exit(0);
