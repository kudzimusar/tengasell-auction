// Gap-8 engine verification round 2 — works with live auctions that have bids.
import { io } from "socket.io-client";
const TB = "http://localhost:3001";
async function tbLogin(u: string, p: string) {
  const res = await fetch(`${TB}/api/auth/v1/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
  return (await res.json()).auth_token;
}
function rpc(s: any, event: string, data: Record<string, unknown>) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 9000);
    s.emit(event, data, (res: any) => { clearTimeout(t); resolve(res); });
  });
}
const rufaroToken = await tbLogin("rufaro", "Tengasell#2025");
const s = io("http://localhost:3002", { auth: { token: rufaroToken }, transports: ["websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));
const me = (await (await fetch(`${TB}/api/records/v1/profiles?filter[username][$eq]=rufaro&limit=1`)).json()).records[0];
const adminToken = await tbLogin("admin", "Tengasell#2025");
const { records: live } = await (await fetch(`${TB}/api/records/v1/auctions?filter[status][$eq]=live&limit=100`)).json();
console.log("live auctions:", live.map((a: any) => `${a.id}/${a.seller_username}/bids=${a.bid_count}/feat=${a.featured}`).join(" | "));

const target = live.find((a: any) => a.user !== me.user && a.live_session_id == null)!;
// enable offers on it (admin patch)
const okPatch = await fetch(`${TB}/api/records/v1/auctions/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ allow_offers: 1, offer_min: 5 }) });
console.log("enable offers on", target.id, "→", okPatch.ok);

// offer below min
const low = await rpc(s, "offer:submit", { auctionId: target.id, amount: 2, message: "lowball" });
console.log("offer below-min auto-decline →", low.ok === false, "|", (low as any).error);
// valid offer
const offer = await rpc(s, "offer:submit", { auctionId: target.id, amount: Math.round(target.current_price * 1.5), message: "Can collect today in Harare." });
console.log("offer:submit →", offer.ok, "id=" + (offer as any).offer?.id, "status=" + (offer as any).offer?.status);
const dup = await rpc(s, "offer:submit", { auctionId: target.id, amount: 99 });
console.log("dup pending rejected →", dup.ok === false, "|", (dup as any).error);

// place a bid then retract it (lead bid retract)
const before = await (await fetch(`${TB}/api/records/v1/auctions/${target.id}`)).json();
const bid = await rpc(s, "bid:place", { auctionId: target.id, maxAmount: Math.round(before.current_price + 60) });
console.log("bid:place →", bid.ok, "amount=" + (bid as any).amount, "winning=" + (bid as any).winning);
const { records: latest } = await (await fetch(`${TB}/api/records/v1/bids?filter[auction_id][$eq]=${target.id}&order=-id&limit=3`)).json();
const mine = latest.find((b: any) => b.user === me.user && b.status === "active");
if (mine) {
  const ret = await rpc(s, "bid:retract", { bidId: mine.id, reason: "Entered the wrong maximum by mistake, re-bidding." });
  console.log("bid:retract →", ret.ok, (ret as any).error ?? "");
  const after = await (await fetch(`${TB}/api/records/v1/auctions/${target.id}`)).json();
  console.log("price after retract:", before.current_price, "→", after.current_price, "| bids:", before.bid_count, "→", after.bid_count);
}
// retraction reason validation
if (mine) {
  const bad = await rpc(s, "bid:retract", { bidId: mine.id, reason: "short" });
  console.log("short reason rejected →", bad.ok === false);
}

// featured on own listing (rufaro's live one)
const mineLive = live.find((a: any) => a.user === me.user && a.featured === 0 && a.live_session_id == null);
if (mineLive) {
  const f = await rpc(s, "listing:feature", { auctionId: mineLive.id });
  console.log("listing:feature →", f.ok, "| already-feat error:", (f as any).error ?? "ok");
  const again = await rpc(s, "listing:feature", { auctionId: mineLive.id });
  console.log("feature twice rejected →", again.ok === false, "|", (again as any).error);
}

// room: reuse session 1 — add rufaro's lot and open it
const roomList = await (await fetch(`${TB}/api/records/v1/live_sessions?limit=10`)).json();
console.log("sessions:", roomList.records.map((x: any) => `${x.id}/${x.title}/${x.status}`).join(" | "));
const sess = roomList.records[0];
const lotCand = live.find((a: any) => a.user === me.user && a.bid_count === 0 && a.live_session_id == null && a.featured === 0);
console.log("lot candidate:", lotCand?.id, "bids=" + lotCand?.bid_count);
if (sess && lotCand) {
  const add = await rpc(s, "room:add-lot", { sessionId: sess.id, auctionId: lotCand.id });
  console.log("room:add-lot →", add.ok, (add as any).error ?? "");
  const open = await rpc(s, "host:open-lot", { sessionId: sess.id });
  console.log("host:open-lot →", open.ok, "status=" + (open as any).session?.status, "currentLot=" + (open as any).session?.current_lot_id);
  const end = await rpc(s, "host:end-session", { sessionId: sess.id });
  console.log("end w/ open lot rejected →", end.ok === false, "|", (end as any).error);
}
s.disconnect();
process.exit(0);
