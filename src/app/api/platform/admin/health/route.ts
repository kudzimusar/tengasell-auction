// GET /api/platform/admin/health — system health view (CTL-023, OPS-006,
// EXE-001). One card per service, each with status (ok/degraded/down),
// latency ms and key stats. Checks run server-side with hard budgets so a
// dead service never stalls the panel; degraded = reachable but unhealthy
// payload/status. 30s auto-refresh is client-side. Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, readFlags, requireAdmin, svcFetch, PORTS } from "@/lib/server/platform";
import { tbListCount } from "@/lib/server/platform";

interface ServiceCard {
  key: string;
  name: string;
  port: number;
  status: "ok" | "degraded" | "down";
  latency_ms: number | null;
  stats?: Record<string, unknown>;
  note?: string;
}

async function probe(
  key: string,
  name: string,
  port: number,
  check: () => Promise<{ ok: boolean; degraded?: boolean; stats?: Record<string, unknown>; note?: string }>,
): Promise<ServiceCard> {
  const started = Date.now();
  try {
    const r = await check();
    const latency = Date.now() - started;
    return {
      key,
      name,
      port,
      status: !r.ok ? "down" : r.degraded ? "degraded" : "ok",
      latency_ms: latency,
      stats: r.stats,
      note: r.note,
    };
  } catch {
    return {
      key,
      name,
      port,
      status: "down",
      latency_ms: Date.now() - started,
      note: "unreachable",
    };
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  // freshness signal: newest audit event (platform-wide last activity)
  const audit = await tbListCount("audit_events", { order: "-id", limit: 1 });
  const lastEvent = (audit.records[0] ?? null) as Record<string, unknown> | null;

  const cards = await Promise.all([
    probe("next", "Web app (Next.js)", PORTS.next, async () => ({
      ok: true,
      stats: { note: "serving this console" },
      note: "self-reported by the serving process",
    })),
    probe("trailbase", "TrailBase backend", PORTS.trailbase, async () => {
      const r = await svcFetch(PORTS.trailbase, "/api/records/v1/categories?limit=1", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        degraded: r.ok === false && r.status > 0,
        stats: r.ok ? { records_api: "200" } : undefined,
        note: r.ok ? "records API healthy" : `HTTP ${r.status}`,
      };
    }),
    probe("engine", "Trade engine", PORTS.engine, async () => {
      const r = await svcFetch(PORTS.engine, "/", { timeoutMs: 2000 });
      const okFlag = r.data?.ok === true;
      return {
        ok: r.ok,
        degraded: r.ok && !okFlag,
        stats: r.data ?? undefined,
        note: okFlag ? "bidding RPC healthy" : "socket.io attached",
      };
    }),
    probe("gis", "GIS service", PORTS.gis, async () => {
      const r = await svcFetch(PORTS.gis, "/health", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        stats: r.data ?? undefined,
        note: r.ok ? "geocoding + maps healthy" : `HTTP ${r.status}`,
      };
    }),
    probe("comms", "Comms service", PORTS.comms, async () => {
      const r = await svcFetch(PORTS.comms, "/health", { timeoutMs: 2000 });
      const queue = (r.data?.queue ?? null) as Record<string, unknown> | null;
      const providers = (r.data?.providers ?? null) as Record<string, string> | null;
      return {
        ok: r.ok,
        degraded: r.ok && queue != null && Number(queue.failed ?? 0) > 0,
        stats: { ...(queue ?? {}), ...(providers ?? {}) },
        note: r.ok ? "TUCS channels + queue healthy" : `HTTP ${r.status}`,
      };
    }),
    probe("finance", "Finance service", PORTS.finance, async () => {
      const r = await svcFetch(PORTS.finance, "/health", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        stats: r.data ?? undefined,
        note: r.ok ? "fees, escrow, payouts healthy" : "provisioning (12-b build) or down",
      };
    }),
    probe("trust", "Trust service", PORTS.trust, async () => {
      const r = await svcFetch(PORTS.trust, "/health", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        stats: r.data ?? undefined,
        note: r.ok ? "tickets, enforcement, MFA authority healthy" : "provisioning (12-c build) or down",
      };
    }),
    probe("govern", "Govern service", PORTS.govern, async () => {
      const r = await svcFetch(PORTS.govern, "/health", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        stats: r.data ?? undefined,
        note: r.ok ? "policies, privacy, registers healthy" : "provisioning (12-d build) or down",
      };
    }),
    probe("gateway", "Gateway (Caddy)", PORTS.gateway, async () => {
      const r = await svcFetch(PORTS.gateway, "/", { timeoutMs: 2000 });
      return {
        ok: r.ok,
        note: r.ok ? "public entry :81 healthy" : `HTTP ${r.status}`,
      };
    }),
  ]);

  const flags = readFlags();
  const down = cards.filter((c) => c.status === "down").length;

  return NextResponse.json({
    ok: true,
    checked_at: new Date().toISOString(),
    services: cards,
    summary: { total: cards.length, ok: cards.filter((c) => c.status === "ok").length, degraded: cards.filter((c) => c.status === "degraded").length, down },
    freshness: lastEvent ? { last_event_at: String(lastEvent.created_at ?? ""), action: String(lastEvent.action ?? "") } : null,
    alerts_enabled: flags.find((f) => f.key === "alerts_enabled")?.value ?? false,
    maintenance_mode: flags.find((f) => f.key === "maintenance_mode")?.value ?? false,
  });
}
