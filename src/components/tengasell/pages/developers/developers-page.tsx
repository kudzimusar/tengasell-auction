"use client";

// Tengasell — Developers & AI agents page (#/developers) · Task 5-d.
// "MCPs and AI agents" showcase: architecture diagram, REST/socket/assistant
// endpoint reference, agent quickstart, MCP surface, audit trail, live status.
// NOTE: in-page anchors use scroll buttons — raw href="#id" would clobber the
// hash-router route.

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CreditCard,
  Database,
  Gauge,
  Map,
  PlugZap,
  Radio,
  ScrollText,
  Server,
  SquareArrowOutUpRight,
  Terminal,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/tengasell/auth";
import { useResource } from "@/lib/tengasell/hooks";
import { SectionHeader } from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";
import { Architecture } from "./architecture";
import { CodeBlock } from "./code-block";

// ── content ─────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "architecture", label: "Architecture" },
  { id: "endpoints", label: "API reference" },
  { id: "payments", label: "Payments" },
  { id: "geo", label: "Geo & Maps" },
  { id: "quickstart", label: "Agent quickstart" },
  { id: "mcp", label: "MCP" },
  { id: "audit", label: "Audit trail" },
  { id: "status", label: "Status" },
] as const;

const HERO_CHIPS = ["TrailBase (Rust)", "SQLite", "REST + realtime", "MCP-ready"] as const;

const AUCTIONS_CURL = `curl 'https://<host>/api/records/v1/auctions?filter[status][$eq]=live&order=ends_at&limit=5&XTransformPort=3001'`;

const HEALTH_CURL = `curl 'https://<host>/api/records/v1/categories?limit=1&count=true&XTransformPort=3001'`;

const REST_SURFACE = `GET     /api/records/v1/{collection}          → list
POST    /api/records/v1/{collection}          → create  (returns ids)
GET     /api/records/v1/{collection}/{id}     → read
PATCH   /api/records/v1/{collection}/{id}     → update
DELETE  /api/records/v1/{collection}/{id}     → delete

# list query params
?filter[status][$eq]=live        # $eq · $like (%…%) · $gte · $lte
&order=-ends_at                  # leading “-” = descending
&limit=50&offset=0               # pagination
&count=true                      # response includes total_count`;

const COLLECTIONS: { name: string; read: string; write: string; publicRead: boolean }[] = [
  { name: "categories", read: "Public", write: "Admin", publicRead: true },
  { name: "profiles", read: "Public", write: "Owner", publicRead: true },
  { name: "auctions", read: "Public", write: "Owner (seller)", publicRead: true },
  { name: "bids", read: "Public", write: "Trade engine · admin", publicRead: true },
  { name: "questions", read: "Public", write: "Asker · seller", publicRead: true },
  { name: "ratings", read: "Public", write: "Order parties", publicRead: true },
  { name: "watchlist", read: "Owner (scoped)", write: "Owner", publicRead: false },
  { name: "threads", read: "Participants", write: "Participants", publicRead: false },
  { name: "messages", read: "Participants", write: "Participants", publicRead: false },
  { name: "orders", read: "Buyer · seller", write: "Trade engine · parties", publicRead: false },
  { name: "payments", read: "Order parties", write: "Trade engine · Paynow routes", publicRead: false },
  { name: "paynow_sessions", read: "Order parties", write: "Paynow routes (admin)", publicRead: false },
  { name: "notifications", read: "Owner", write: "System", publicRead: false },
  { name: "audit_events", read: "Admin", write: "System · actions", publicRead: false },
];

const AUTH_SURFACE = `POST /api/auth/v1/register   { "username": "…", "password": "…", "password_repeat": "…" }
POST /api/auth/v1/login      { "username": "…", "password": "…" }
                             → { "auth_token": "…", "refresh_token": "…" }
GET  /api/auth/v1/status     Header: Authorization: Bearer <auth_token>
POST /api/auth/v1/logout     (Bearer) — invalidates the session`;

const LOGIN_CURL = `curl -X POST 'https://<host>/api/auth/v1/login?XTransformPort=3001' \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"simba","password":"Tengasell#2025"}'
# demo account — every seeded persona uses the same password`;

const SOCKET_JS = `import { io } from "socket.io-client";

// single external port — the gateway routes by XTransformPort
const socket = io("/?XTransformPort=3002", {
  auth: { token: auth_token }, // from /api/auth/v1/login
});

// RPC: emit with an acknowledgement callback
socket.emit("bid:place", { auctionId: 1026, maxAmount: 260 }, (res) => {
  // { ok, auction?, outbid?, amount? }
});

// broadcasts (server → you)
socket.on("auction:update", (a) => console.log(a.id, a.current_price));
socket.on("message:new", console.log);`;

const RPC_EVENTS = [
  { event: "bid:place", payload: "{ auctionId, maxAmount }", note: "Proxy bidding + anti-snipe enforced server-side" },
  { event: "buynow:purchase", payload: "{ auctionId }", note: "Creates an order; buy-now vanishes after the first bid" },
  { event: "message:send", payload: "{ threadId? · auctionId? · toUsername?, body }", note: "Opens or appends to a thread" },
  { event: "question:ask", payload: "{ auctionId, body }", note: "Public Q&A on the listing" },
  { event: "question:answer", payload: "{ questionId, body }", note: "Seller only" },
  { event: "order:pay", payload: "{ orderId, method, reference? }", note: "Direct methods — Paynow orders settle via /api/paynow/*" },
  { event: "order:ship", payload: "{ orderId, carrier, tracking }", note: "Seller only" },
  { event: "order:deliver", payload: "{ orderId }", note: "Buyer confirms delivery — releases held funds" },
  { event: "order:rate", payload: "{ orderId, score, comment }", note: "1–5 stars, both sides of the trade" },
] as const;

const BROADCASTS = [
  "auction:update",
  "message:new",
  "notification:new",
  "order:update",
  "question:update",
] as const;

const ASSISTANT_API = `POST /api/assistant                # Next.js API route — no gateway port needed
Content-Type: application/json

{
  "messages": [ { "role": "user", "content": "Is item 1026 a good deal?" } ],
  "context":  { "route": "/item/1026" }
}`;

const PAYNOW_ENDPOINTS = [
  {
    method: "POST",
    path: "/api/paynow/initiate",
    body: "{ orderId, method, phone? }",
    note: "Buyer Bearer token. Opens a gateway session → { reference, redirectUrl, pollUrl, mock }",
  },
  {
    method: "POST",
    path: "/api/paynow/poll",
    body: "{ reference }",
    note: "Session status (pending · paid · cancelled); returns the settled order when paid",
  },
  {
    method: "POST",
    path: "/api/paynow/sandbox",
    body: "{ reference, action }",
    note: "approve|decline — sandbox simulation only, 403 when real credentials are set",
  },
  {
    method: "POST",
    path: "/api/paynow/callback",
    body: "form-encoded",
    note: "Paynow resulturl webhook — hash-verified, replies exactly “OK”",
  },
] as const;

const PAYNOW_HASH = `# Paynow hash — MD5, uppercase (verified on every request/response)
1. concatenate the field VALUES:
   · initiate requests, fixed order: id, reference, amount, additionalinfo,
     returnurl, resulturl, authemail, status ("Message")
     — method + phone are appended for EcoCash/InnBucks mobile money
   · poll/callback responses: every returned value EXCEPT "hash",
     in the order the fields appear
2. encodeURIComponent() the concatenated string
3. append the integration key
4. MD5 hex digest, uppercase

hash = MD5( encodeURIComponent(concatenation) + INTEGRATION_KEY ).toUpperCase()`;

const PAYNOW_ENV = `# sandbox (default — no credentials configured):
#   sessions are local; the redirect lands on #/pay/{reference}, our
#   hosted sandbox checkout; approve/decline simulate the buyer's phone.

# production:
PAYNOW_INTEGRATION_ID=…            # from paynow.co.zw merchant settings
PAYNOW_INTEGRATION_KEY=…           # keep server-side only
PAYNOW_RETURN_URL=https://<host>/   # where the buyer lands after paying
PAYNOW_RESULT_URL=https://<host>/api/paynow/callback  # webhook (hash-verified)`;

const PAYNOW_CURL = `# 1 · login as the buyer (through the gateway, as usual)
TOKEN=$(curl -s -X POST 'https://<host>/api/auth/v1/login?XTransformPort=3001' \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"simba","password":"Tengasell#2025"}' | jq -r .auth_token)

# 2 · start a Paynow payment (Next.js route — NO XTransformPort)
curl -s -X POST 'https://<host>/api/paynow/initiate' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"orderId":13,"method":"ecocash","phone":"+263771234567"}'
# → { "ok": true, "reference": "TS-ORDR13-…", "redirectUrl": "#/pay/…", "mock": true }

# 3 · poll the session
curl -s -X POST 'https://<host>/api/paynow/poll' \\
  -H 'Content-Type: application/json' -d '{"reference":"TS-ORDR13-…"}'`;

const QUICKSTART = [
  {
    title: "Register a user via REST",
    body: "POST /api/auth/v1/register with username + password (repeated). The demo auth policy is username-only — agents are welcome, no email hoops.",
  },
  {
    title: "Login, save auth_token",
    body: "POST /api/auth/v1/login returns { auth_token, refresh_token }. Send it as Authorization: Bearer … and in the socket auth payload.",
  },
  {
    title: "Read auctions (public)",
    body: "GET /api/records/v1/auctions needs no token. Filter, order and paginate with query params — the curl below is a working session.",
  },
  {
    title: "Place bids via trade-engine socket RPC",
    body: "emit bid:place { auctionId, maxAmount }. Proxy bidding and anti-snipe are enforced server-side — you cannot out-trick the close.",
  },
  {
    title: "Watch items via watchlist REST",
    body: "POST /api/records/v1/watchlist { auction_id } with the Bearer token. Lists auto-scope to the calling user (owner-scoped).",
  },
  {
    title: "Everything is audited",
    body: "Every agent action lands in the audit_events table with source “agent” — who, what, and the payload snapshot.",
  },
] as const;

const QUICKSTART_BASH = `# 1 · register an agent user
curl -X POST 'https://<host>/api/auth/v1/register?XTransformPort=3001' \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"my_agent","password":"s3cret-pass","password_repeat":"s3cret-pass"}'

# 2 · login → save the token
TOKEN=$(curl -s -X POST 'https://<host>/api/auth/v1/login?XTransformPort=3001' \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"my_agent","password":"s3cret-pass"}' | jq -r .auth_token)

# 3 · read live auctions (public — no token needed)
curl 'https://<host>/api/records/v1/auctions?filter[status][$eq]=live&order=ends_at&limit=5&XTransformPort=3001'

# 5 · watch an item (owner-scoped)
curl -X POST 'https://<host>/api/records/v1/watchlist?XTransformPort=3001' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"auction_id":1026}'`;

const QUICKSTART_JS = `// 4 · place bids through the trade engine (rules enforced server-side)
const socket = io("/?XTransformPort=3002", { auth: { token: TOKEN } });

socket.emit("bid:place", { auctionId: 1026, maxAmount: 260 }, (res) => {
  // outbid by someone's proxy max? react like a well-behaved agent:
  if (res.outbid) socket.emit("bid:place", { auctionId: 1026, maxAmount: res.amount + 10 });
});`;

const MCP_CMD = `# TrailBase ships a built-in MCP server over its records API
trail mcp http://localhost:3001 \\
  --tokens=$(trail --depot=/srv/tengasell user mint my_agent)`;

const AUDIT_COLUMNS = [
  { col: "action", meaning: "what happened — bid.place, order.pay, watch.add…" },
  { col: "entity · entity_id", meaning: "what it touched — auction 1026, order 4811…" },
  { col: "source", meaning: "where it came from — web · agent · mcp" },
  { col: "user", meaning: "who (opaque base64 user id)" },
  { col: "payload", meaning: "JSON snapshot of the change" },
  { col: "created_at", meaning: "when it happened" },
] as const;

const AUDIT_ROW = `{
  "action": "bid.place",
  "entity": "auction",
  "entity_id": 1026,
  "source": "agent",
  "user": "b3NhaXV1ZC1ibG9i",
  "payload": { "maxAmount": 260, "amount": 251 }
}`;

/** Live health probe — 1.5s timeout, straight through the gateway. */
async function probeRecordsApi(): Promise<{ total: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch("/api/records/v1/categories?limit=1&count=true&XTransformPort=3001", {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { total_count?: number };
    return { total: data.total_count ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ── page ────────────────────────────────────────────────────────────

export default function DevelopersPage() {
  const reduced = useReducedMotion();
  const { engineConnected } = useAuth();
  const health = useResource(probeRecordsApi, []);

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });

  const fadeUp = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-40px" },
          transition: { duration: 0.45, delay, ease: "easeOut" as const },
        };

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-6 sm:space-y-14 sm:py-8">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section aria-labelledby="dev-hero-title" className="overflow-hidden rounded-card border border-border bg-raised">
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col justify-center gap-5 p-6 sm:p-10">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-teal-tint px-3 py-1 text-label font-bold text-teal-deep">
              <Terminal className="size-4" aria-hidden="true" />
              For developers & AI agents
            </span>
            <h1 id="dev-hero-title" className="text-display leading-tight text-foreground">
              Tengasell for <span className="text-gold-deep">developers & AI agents</span>
            </h1>
            <p className="max-w-lg text-body text-muted-foreground">
              Trade the same surface our SPA uses — a Rust-backed records API, a realtime
              trade engine with honest rules, and an LLM assistant wired to live item
              data. Build bots, dashboards and MCP agents today.
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Platform stack">
              {HERO_CHIPS.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-border bg-section px-3 py-1.5 text-label text-foreground"
                >
                  {chip}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" className="h-12 min-h-11 px-6" onClick={() => scrollTo("endpoints")}>
                API reference
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 min-h-11 px-5"
                onClick={() => scrollTo("quickstart")}
              >
                Agent quickstart
              </Button>
            </div>
          </div>
          <div className="hidden flex-col justify-center gap-2.5 p-6 sm:p-8 lg:flex">
            <CodeBlock label="health-check" code={HEALTH_CURL} />
            <p className="text-caption text-muted-foreground">
              One GET is all you need to know the marketplace is awake — 200 + records is
              your green light.
            </p>
          </div>
        </div>
      </section>

      {/* ── section nav (scroll buttons, not hrefs — hash-router safe) ── */}
      <nav aria-label="Page sections" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className="min-h-11 rounded-full border border-border bg-raised px-4 text-label text-foreground transition-colors hover:border-teal/50 hover:bg-teal-tint/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* ── Architecture ─────────────────────────────────────────── */}
      <motion.section id="architecture" aria-labelledby="arch-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Server className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="arch-title">Architecture</span>}
          subtitle="One external port, three backing services — the gateway routes by XTransformPort"
        />
        <Architecture />
      </motion.section>

      {/* ── Endpoint reference (Tabs) ────────────────────────────── */}
      <motion.section id="endpoints" aria-labelledby="endpoints-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Database className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="endpoints-title">API reference</span>}
          subtitle="Records · Auth · Socket RPC · Assistant — the complete surface"
        />
        <Tabs defaultValue="records" className="gap-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="records" className="flex-1 px-3 sm:flex-none">
              Records
            </TabsTrigger>
            <TabsTrigger value="auth" className="flex-1 px-3 sm:flex-none">
              Auth
            </TabsTrigger>
            <TabsTrigger value="socket" className="flex-1 px-3 sm:flex-none">
              Socket RPC
            </TabsTrigger>
            <TabsTrigger value="assistant" className="flex-1 px-3 sm:flex-none">
              Assistant
            </TabsTrigger>
          </TabsList>

          {/* Records */}
          <TabsContent value="records" className="space-y-3">
            <CodeBlock label="REST" code={REST_SURFACE} />
            <p className="text-body text-muted-foreground">
              Responses: list →{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">
                {"{ records, total_count, cursor }"}
              </code>
              , create →{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">
                {"{ ids: [\"…\"] }"}
              </code>
              , PATCH/DELETE → 200. Row-level ACLs are enforced by SQL access rules on
              the server.
            </p>
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-11 text-label">Collection</TableHead>
                      <TableHead className="h-11 text-label">Read access</TableHead>
                      <TableHead className="h-11 text-label">Write access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COLLECTIONS.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="py-2.5 font-mono text-caption font-semibold text-foreground">
                          {c.name}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <AccessBadge label={c.read} tone={c.publicRead ? "public" : "scoped"} />
                        </TableCell>
                        <TableCell className="py-2.5 text-caption text-muted-foreground">
                          {c.write}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-caption text-muted-foreground">
              Public READ collections: categories, profiles, auctions, bids, questions,
              ratings — everything else is authenticated and row-scoped to its owner or
              participants.
            </p>
          </TabsContent>

          {/* Auth */}
          <TabsContent value="auth" className="space-y-3">
            <CodeBlock label="auth" code={AUTH_SURFACE} />
            <CodeBlock label="curl" code={LOGIN_CURL} />
            <p className="text-caption text-muted-foreground">
              Tokens are opaque — treat them as strings. The SPA keeps the auth_token in
              memory/localStorage and refreshes via /status on boot.
            </p>
          </TabsContent>

          {/* Socket RPC */}
          <TabsContent value="socket" className="space-y-3">
            <CodeBlock label="js" code={SOCKET_JS} />
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-11 text-label">RPC event</TableHead>
                      <TableHead className="h-11 text-label">Payload</TableHead>
                      <TableHead className="h-11 text-label">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RPC_EVENTS.map((e) => (
                      <TableRow key={e.event}>
                        <TableCell className="py-2.5 font-mono text-caption font-semibold text-teal-deep">
                          {e.event}
                        </TableCell>
                        <TableCell className="py-2.5 font-mono text-caption text-foreground">
                          {e.payload}
                        </TableCell>
                        <TableCell className="py-2.5 text-caption text-muted-foreground">
                          {e.note}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-raised p-3.5">
              <Radio className="size-4.5 shrink-0 text-teal" aria-hidden="true" />
              <span className="text-label font-semibold text-foreground">Broadcasts:</span>
              {BROADCASTS.map((b) => (
                <code
                  key={b}
                  className="rounded-full bg-teal-tint px-2.5 py-1 font-mono text-caption font-semibold text-teal-deep"
                >
                  {b}
                </code>
              ))}
            </div>
          </TabsContent>

          {/* Assistant */}
          <TabsContent value="assistant" className="space-y-3">
            <CodeBlock label="http" code={ASSISTANT_API} />
            <p className="text-body text-muted-foreground">
              The assistant is the LLM behind{" "}
              <span className="font-semibold text-foreground">Tenga AI</span> (#/assistant).
              Mention an item in a message — e.g. “item 1026” — and the backend injects
              live listing + bid context before answering. Roles: user / assistant;
              history is trimmed server-side too.
            </p>
          </TabsContent>
        </Tabs>
      </motion.section>

      {/* ── Gateway callout ──────────────────────────────────────── */}
      <motion.section
        aria-labelledby="gateway-callout-title"
        className="rounded-card border border-gold/50 bg-gold-soft/60 p-4 sm:p-5"
        {...fadeUp()}
      >
        <div className="flex gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-gold-deep" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <h2 id="gateway-callout-title" className="text-title font-bold text-gold-on">
              IMPORTANT — every browser request must append ?XTransformPort
            </h2>
            <p className="text-caption leading-relaxed text-gold-on/80">
              Tengasell exposes a single external port. The gateway routes by the{" "}
              <code className="rounded bg-gold/20 px-1 py-0.5 font-mono">XTransformPort</code>{" "}
              query parameter: records + auth go to TrailBase (
              <code className="rounded bg-gold/20 px-1 py-0.5 font-mono">3001</code>), the
              socket handshake goes to the trade engine (
              <code className="rounded bg-gold/20 px-1 py-0.5 font-mono">3002</code>).
              A request without it lands on the Next.js app.
            </p>
            <CodeBlock label="curl" code={AUCTIONS_CURL} />
          </div>
        </div>
      </motion.section>

      {/* ── Payments — Paynow ────────────────────────────────────── */}
      <motion.section id="payments" aria-labelledby="payments-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<CreditCard className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="payments-title">Payments — Paynow</span>}
          subtitle="Zimbabwe's payment aggregator (EcoCash · InnBucks · Visa · ZimSwitch) behind our own API routes"
        />
        <div className="space-y-3">
          <p className="text-body text-muted-foreground">
            Buy-now and order payments can run through the{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">paynow</code>{" "}
            method. The SPA never talks to paynow.co.zw directly — these Next.js routes hold the
            integration key, sign every request, and settle orders server-side ({" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">no XTransformPort</code>{" "}
            — they are Next&apos;s own routes). Sandbox mode is active until credentials are
            configured.
          </p>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11 text-label">Endpoint</TableHead>
                    <TableHead className="h-11 text-label">Body</TableHead>
                    <TableHead className="h-11 text-label">Behaviour</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PAYNOW_ENDPOINTS.map((e) => (
                    <TableRow key={e.path}>
                      <TableCell className="py-2.5 font-mono text-caption font-semibold text-teal-deep">
                        {e.method} {e.path}
                      </TableCell>
                      <TableCell className="py-2.5 font-mono text-caption text-muted-foreground">
                        {e.body}
                      </TableCell>
                      <TableCell className="py-2.5 text-caption text-muted-foreground">
                        {e.note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <CodeBlock label="hash algorithm" code={PAYNOW_HASH} />
            <CodeBlock label="sandbox vs production" code={PAYNOW_ENV} />
          </div>
          <CodeBlock label="curl" code={PAYNOW_CURL} />
          <p className="text-caption text-muted-foreground">
            Sessions live in the <code className="font-mono">paynow_sessions</code> collection
            (admin-written, order parties can read). Settlement mirrors the trade engine&apos;s{" "}
            <code className="font-mono">order:pay</code>: order → paid, a settled{" "}
            <code className="font-mono">payments</code> row, seller notification and an audit
            event — one row per attempt, keyed by the TS-ORDR reference.
          </p>
        </div>
      </motion.section>

      {/* ── Agent quickstart ─────────────────────────────────────── */}
      <motion.section id="quickstart" aria-labelledby="quickstart-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Zap className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="quickstart-title">Agent quickstart</span>}
          subtitle="From zero to a bidding agent in six steps — copy, paste, trade"
        />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICKSTART.map((step, i) => (
            <li key={step.title} className="rounded-card border border-border bg-raised p-4">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-teal text-label font-extrabold text-white"
                >
                  {i + 1}
                </span>
                <h3 className="text-label font-bold leading-snug text-foreground">{step.title}</h3>
              </div>
              <p className="mt-2 text-caption leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-1 grid gap-3">
          <CodeBlock label="agent-session.sh" code={QUICKSTART_BASH} />
          <CodeBlock label="agent-bids.js" code={QUICKSTART_JS} />
        </div>
      </motion.section>

      {/* ── MCP ──────────────────────────────────────────────────── */}
      <motion.section id="mcp" aria-labelledby="mcp-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<PlugZap className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="mcp-title">MCPs and AI agents</span>}
          subtitle="TrailBase ships a built-in MCP server — our socket RPC and assistant API ride along as agent tools"
        />
        <div className="space-y-3">
          <p className="text-body text-muted-foreground">
            TrailBase v0.35 exposes its records API as standard{" "}
            <span className="font-semibold text-foreground">MCP tools</span> out of the
            box — agents like Claude, Cursor or your own bots get typed read/list/create
            access to every collection above, behind the same row-level ACLs the REST
            API enforces.
          </p>
          <CodeBlock label="mcp" code={MCP_CMD} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-border bg-raised p-4">
              <h3 className="text-label font-bold text-foreground">+ Trade-engine socket RPC</h3>
              <p className="mt-1.5 text-caption leading-relaxed text-muted-foreground">
                Bids, buy-now, orders, chat and Q&A with proxy bidding and anti-snipe
                enforced server-side — the honest-rules surface agents can&apos;t game.
              </p>
            </div>
            <div className="rounded-card border border-border bg-raised p-4">
              <h3 className="text-label font-bold text-foreground">+ Assistant API</h3>
              <p className="mt-1.5 text-caption leading-relaxed text-muted-foreground">
                POST /api/assistant gives agents the LLM copilot with live item context —
                price checks, strategy, drafted messages.
              </p>
            </div>
          </div>
          <p className="text-body text-muted-foreground">
            Health check / JSON manifest:{" "}
            <a
              href="/api/records/v1/categories?XTransformPort=3001"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-caption font-semibold text-teal underline decoration-teal/40 underline-offset-2 hover:decoration-teal"
            >
              GET /api/records/v1/categories?XTransformPort=3001
              <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </p>
          <p className="flex items-start gap-2 rounded-control bg-teal-tint/60 p-3 text-caption leading-relaxed text-teal-deep">
            <span aria-hidden="true" className="mt-0.5 font-bold">
              ⓘ
            </span>
            Honest note: full MCP server enablement is one command on the deployment
            host. Today the records API, auth and trade engine are live —{" "}
            <code className="font-mono">trail mcp</code> is standing by.
          </p>
        </div>
      </motion.section>

      {/* ── Audit trail ──────────────────────────────────────────── */}
      <motion.section id="audit" aria-labelledby="audit-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<ScrollText className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="audit-title">Audit trail</span>}
          subtitle="audit_events — every agent action is recorded"
        />
        <div className="space-y-3">
          <p className="text-body text-muted-foreground">
            Every write on the marketplace appends a row to{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">audit_events</code>
            . Human traders and agents share the same journal — there is no back door.
          </p>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11 text-label">Column</TableHead>
                    <TableHead className="h-11 text-label">Meaning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AUDIT_COLUMNS.map((c) => (
                    <TableRow key={c.col}>
                      <TableCell className="py-2.5 font-mono text-caption font-semibold text-teal-deep">
                        {c.col}
                      </TableCell>
                      <TableCell className="py-2.5 text-caption text-muted-foreground">
                        {c.meaning}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <CodeBlock label="audit_events row" code={AUDIT_ROW} />
        </div>
      </motion.section>

      {/* ── Status ───────────────────────────────────────────────── */}
      <motion.section id="status" aria-labelledby="status-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Gauge className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="status-title">Live status</span>}
          subtitle="Records API probe (1.5s timeout) + trade-engine socket state"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatusCard
            icon={Database}
            title={
              health.loading
                ? "Records API — checking…"
                : health.error
                  ? "Records API — demo mode"
                  : "TrailBase :3001 — live"
            }
            state={health.loading ? "loading" : health.error ? "warn" : "ok"}
            onRetry={health.error || !health.loading ? health.reload : undefined}
          >
            {health.loading ? (
              <p>Probing TrailBase :3001 through the gateway…</p>
            ) : health.error ? (
              <p>Probe failed ({health.error}). The SPA falls back to the offline demo store.</p>
            ) : (
              <p>
                Records API responding · {health.data?.total ?? 0} categories · SQLite ·
                Rust
              </p>
            )}
          </StatusCard>

          <StatusCard
            icon={Zap}
            title={engineConnected ? "Trade engine :3002 — connected" : "Trade engine :3002 — offline"}
            state={engineConnected ? "ok" : "warn"}
          >
            <p>
              {engineConnected
                ? "socket.io RPC live · bids, orders and chat available"
                : "RPC calls unavailable — the engine restarts automatically on the host"}
            </p>
          </StatusCard>
        </div>
        <CodeBlock label="health-check" code={HEALTH_CURL} className="mt-3" />
      </motion.section>

      {/* ── Geo & Maps ──────────────────────────────────────────────── */}
      <motion.section id="geo" aria-labelledby="geo-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Map className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="geo-title">Geo & Maps — open-source GIS stack</span>}
          subtitle="Nominatim/Photon geocoding · OSRM routing · MapLibre GL JS tiles — no proprietary map APIs"
        />
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[640px] text-caption">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-start text-label font-bold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 text-start">Endpoint</th>
                <th className="px-3 py-2.5 text-start">Purpose</th>
                <th className="px-3 py-2.5 text-start">Sandbox backend (:3004)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["GET /api/geo/search?q=", "Forward geocode (address → coords)", "Nominatim-compatible /search"],
                ["GET /api/geo/reverse?lat=&lng=", "Reverse geocode (GPS → address)", "Nominatim-compatible /reverse"],
                ["GET /api/geo/autocomplete?q=", "Type-ahead address suggestions", "Photon-compatible /api"],
                ["GET /api/geo/route?fromLat=&fromLng=&toLat=&toLng=", "Driving route + geometry", "OSRM-compatible /route/v1"],
                ["GET /api/geo/quote?origin=&destination=&shipping=", "Delivery price + ETA quote", "Road-graph quote engine"],
                ["GET /data/zimbabwe/{z}/{x}/{y}.pbf?XTransformPort=3004", "Vector tiles (MapLibre)", "Hand-rolled MVT v2.1 encoder"],
                ["GET /osm/{z}/{x}/{y}.png?XTransformPort=3004", "REAL OSM raster basemap tiles", "Cached proxy → tile.openstreetmap.org (disk + memory, OSM-policy UA); vector tiles are the offline fallback"],
                ["GET /styles/tengasell.json?XTransformPort=3004", "MapLibre style document", "OSM raster basemap + Tengasell gazetteer overlays"],
              ].map(([ep, purpose, backend]) => (
                <tr key={ep} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2.5 font-mono text-[11px] text-teal">{ep}</td>
                  <td className="px-3 py-2.5 text-foreground">{purpose}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{backend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-caption text-muted-foreground">
          Production swaps the sandbox for real engines via{" "}
          <code className="rounded-control bg-muted px-1.5 py-0.5 font-mono text-[11px]">GIS_BASE_URL</code>{" "}
          — see <code className="rounded-control bg-muted px-1.5 py-0.5 font-mono text-[11px]">infra/gis/docker-compose.yml</code>{" "}
          (Nominatim · Photon · OSRM · TileServer GL). Delivery quote:{" "}
          base (courier $4 / nationwide $2 / pickup $0) + $0.02/km beyond 25 km, capped $60/$45,
          ETA = 1 + km/350.
        </p>
        <CodeBlock
          label="geo-quote example"
          className="mt-3"
          code={`curl "http://localhost:3000/api/geo/quote?origin=-17.8292,31.0522&destination=-20.15,28.5873&shipping=courier"
# → {"ok":true,"distanceKm":439,"durationMinutes":405,"etaDays":2,"priceUsd":12.28,...}`}
        />
      </motion.section>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function AccessBadge({ label, tone }: { label: string; tone: "public" | "scoped" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-caption font-semibold",
        tone === "public"
          ? "border-teal/30 bg-teal-tint text-teal-deep"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
    </Badge>
  );
}

function StatusCard({
  icon: Icon,
  title,
  state,
  onRetry,
  children,
}: {
  icon: typeof Database;
  title: string;
  state: "loading" | "ok" | "warn";
  onRetry?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-raised p-4">
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full",
          state === "ok" && "bg-ok/10 text-ok",
          state === "warn" && "bg-warn/10 text-warn",
          state === "loading" && "animate-pulse bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-bodyStrong text-foreground">{title}</p>
        <div className="text-caption leading-relaxed text-muted-foreground">{children}</div>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={onRetry}>
          Recheck
        </Button>
      )}
    </div>
  );
}
