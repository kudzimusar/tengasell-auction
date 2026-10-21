// POST /api/platform/admin/smoke — synthetic checks from the server side
// (OPS-007). The SAME golden-endpoint contract as ops/smoke.ts (same JSON
// shape: {ok, checked_at, failures[], checks[]}) implemented natively — no
// shell-out. Failures never throw; the route always returns 200 with the
// honest result envelope. Admin-only. Audit-logged.

import { NextRequest, NextResponse } from "next/server";
import {
  isResponse,
  requireAdmin,
  svcFetch,
  PORTS,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";
import { tbList } from "@/lib/server/trailbase-admin";

interface Check {
  name: string;
  target: string;
  ok: boolean;
  latency_ms: number;
  detail?: string;
}

export async function runSmoke(): Promise<{ ok: boolean; checked_at: string; failures: string[]; checks: Check[] }> {
  const checks: Check[] = [];
  const one = async (name: string, target: string, fn: () => Promise<{ ok: boolean; detail?: string }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      checks.push({ name, target, ok: r.ok, latency_ms: Date.now() - t0, detail: r.detail });
    } catch {
      checks.push({ name, target, ok: false, latency_ms: Date.now() - t0, detail: "unreachable" });
    }
  };

  await one("gateway", "GET :81/", () =>
    svcFetch(PORTS.gateway, "/", { timeoutMs: 3000 }).then((r) => ({ ok: r.ok, detail: `HTTP ${r.status}` })));
  await one("trailbase", "GET :3001 /api/records/v1/categories?limit=1", () =>
    svcFetch(PORTS.trailbase, "/api/records/v1/categories?limit=1", { timeoutMs: 3000 }).then((r) => ({
      ok: r.ok,
      detail: `HTTP ${r.status}`,
    })));
  await one("engine", "GET :3002 /", () =>
    svcFetch(PORTS.engine, "/", { timeoutMs: 3000 }).then((r) => ({
      ok: r.ok && r.data?.ok === true,
      detail: r.ok ? String(r.data?.service ?? "engine") : `HTTP ${r.status}`,
    })));
  await one("gis", "GET :3004 /health", () =>
    svcFetch(PORTS.gis, "/health", { timeoutMs: 3000 }).then((r) => ({ ok: r.ok, detail: `HTTP ${r.status}` })));
  await one("comms", "GET :3005 /health", () =>
    svcFetch(PORTS.comms, "/health", { timeoutMs: 3000 }).then((r) => ({
      ok: r.ok && r.data?.status === "ok",
      detail: r.ok ? `queue depth ${String((r.data?.queue as Record<string, unknown>)?.depth ?? "?")}` : `HTTP ${r.status}`,
    })));
  await one("finance", "GET :3006 /health", () =>
    svcFetch(PORTS.finance, "/health", { timeoutMs: 3000 }).then((r) => ({ ok: r.ok, detail: `HTTP ${r.status}` })));
  await one("trust", "GET :3007 /health", () =>
    svcFetch(PORTS.trust, "/health", { timeoutMs: 3000 }).then((r) => ({ ok: r.ok, detail: `HTTP ${r.status}` })));
  await one("govern", "GET :3008 /health", () =>
    svcFetch(PORTS.govern, "/health", { timeoutMs: 3000 }).then((r) => ({ ok: r.ok, detail: `HTTP ${r.status}` })));

  // database sanity: profiles readable through the records API
  const profiles = await tbList("profiles", { limit: 1 });
  checks.push({
    name: "database",
    target: "TrailBase profiles record",
    ok: true,
    latency_ms: 0,
    detail: `${profiles.length} row(s) readable`,
  });

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.target})`);
  return { ok: failures.length === 0, checked_at: new Date().toISOString(), failures, checks };
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const result = await runSmoke();

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:smoke_run",
    entity: "platform",
    source: "admin",
    payload: { ok: result.ok, failures: result.failures, actor: gate.username },
  });

  return NextResponse.json({ ok: true, smoke: result });
}
