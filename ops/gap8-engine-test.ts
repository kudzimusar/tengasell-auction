// Gap-8 engine RPC verification client (run with bun).
import { io } from "socket.io-client";

const TB = "http://localhost:3001";

async function tbLogin(username: string, password: string) {
  const res = await fetch(`${TB}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return data.auth_token;
}

function rpc(s: any, event: string, data: Record<string, unknown>) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 9000);
    s.emit(event, data, (res: any) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

const token = await tbLogin("rufaro", "Tengasell#2025");
const s = io("http://localhost:3002", { auth: { token }, transports: ["websocket"] });
await new Promise<void>((r) => s.on("connect", () => r()));

async function meId() {
  const res = await fetch(`${TB}/api/records/v1/profiles?filter[username][$eq]=rufaro&limit=1`);
  const d = await res.json();
  return d.records[0];
}
const me = await meId();

const auctionsRes = await fetch(`${TB}/api/records/v1/auctions?filter[status][$eq]=live&limit=100`);
const { records: live } = await auctionsRes.json();
const others = live.filter((a: any) => a.user !== me.user && a.live_session_id == null && a.bid_count === 0);
const mineNoBids = live.filter((a: any) => a.user === me.user && a.bid_count === 0 && a.featured === 0 && a.live_session_id == null);
console.log(`live=${live.length} others(no-bids)=${others.length} mine-featured-candidates=${mineNoBids.length}`);

const feat = mineNoBids[0];
if (feat) {
  const r = await rpc(s, "listing:feature", { auctionId: feat.id });
  console.log("listing:feature →", JSON.stringify(r).slice(0, 140));
}

const adminToken = await tbLogin("admin", "Tengasell#2025");
async function tbPatch(id: number, patch: Record<string, unknown>) {
  const res = await fetch(`${TB}/api/records/v1/auctions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(patch),
  });
  return res.ok;
}
const target = others[0];
if (target) {
  await tbPatch(target.id, { allow_offers: 1, offer_min: 5 });
  const low = await rpc(s, "offer:submit", { auctionId: target.id, amount: 2, message: "too low test" });
  console.log("offer below-min →", low.ok, (low as any).error);
  const offer = await rpc(s, "offer:submit", { auctionId: target.id, amount: Math.max(10, target.start_price * 2), message: "cash today" });
  console.log("offer:submit →", offer.ok, (offer as any).offer?.id, (offer as any).offer?.status, (offer as any).error ?? "");
  const dup = await rpc(s, "offer:submit", { auctionId: target.id, amount: 50 });
  console.log("dup offer →", dup.ok, (dup as any).error);
  const bid = await rpc(s, "bid:place", { auctionId: target.id, maxAmount: Math.max(target.start_price + 40, 60) });
  console.log("bid:place →", bid.ok, (bid as any).amount);
  const bidsRes = await fetch(`${TB}/api/records/v1/bids?filter[auction_id][$eq]=${target.id}&order=-id&limit=1`);
  const { records: latest } = await bidsRes.json();
  const latestBid = latest[0];
  const ret = await rpc(s, "bid:retract", { bidId: latestBid.id, reason: "Entered the wrong maximum amount by mistake." });
  console.log("bid:retract →", ret.ok, (ret as any).error ?? "ok");
  const short = await rpc(s, "bid:retract", { bidId: latestBid.id, reason: "short" });
  console.log("retract short-reason rejected →", short.ok === false, (short as any).error?.slice(0, 40));
}

const room = await rpc(s, "room:create", { title: "Saturday Sundowner Live Sale", scheduledAt: new Date().toISOString() });
const sessionId = (room as any).session?.id;
console.log("room:create →", room.ok, sessionId);
if (sessionId && feat) {
  const addLot = await rpc(s, "room:add-lot", { sessionId, auctionId: feat.id });
  console.log("room:add-lot →", addLot.ok, (addLot as any).error ?? "");
  const open = await rpc(s, "host:open-lot", { sessionId });
  console.log("host:open-lot →", open.ok, (open as any).session?.status, (open as any).error ?? "");
  const end = await rpc(s, "host:end-session", { sessionId });
  console.log("host:end-session (should fail w/ lot open) →", end.ok, (end as any).error?.slice(0, 50));
}

s.disconnect();
process.exit(0);
