// ops/smoke.ts — synthetic monitoring checks (OPS-007).
// Run: `bun ops/smoke.ts`
//
// The SAME golden-endpoint contract as the admin console's
// POST /api/platform/admin/smoke (identical checks, identical JSON shape
// {ok, checked_at, failures[], checks[]}) — implemented standalone so the
// on-call path works without a browser session (cron/curl friendly).

interface Check {
  name: string;
  target: string;
  ok: boolean;
  latency_ms: number;
  detail?: string;
}

const BASE = (p: number) => `http://127.0.0.1:${p}`;

async function one(
  name: string,
  target: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<Check> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, target, ok: r.ok, latency_ms: Date.now() - t0, detail: r.detail };
  } catch {
    return { name, target, ok: false, latency_ms: Date.now() - t0, detail: "unreachable" };
  }
}

async function get(port: number, path: string, timeoutMs = 3000): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE(port)}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  checks.push(
    await one("gateway", "GET :81/", async () => {
      const r = await get(81, "/");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("trailbase", "GET :3001 /api/records/v1/categories?limit=1", async () => {
      const r = await get(3001, "/api/records/v1/categories?limit=1");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("engine", "GET :3002 /", async () => {
      const r = await get(3002, "/");
      const ok = r.status === 200 && r.data?.ok === true;
      return { ok, detail: ok ? String(r.data?.service ?? "engine") : `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("gis", "GET :3004 /health", async () => {
      const r = await get(3004, "/health");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("comms", "GET :3005 /health", async () => {
      const r = await get(3005, "/health");
      const queue = (r.data?.queue ?? {}) as Record<string, unknown>;
      return {
        ok: r.status === 200 && r.data?.status === "ok",
        detail: r.status === 200 ? `queue depth ${String(queue.depth ?? "?")}` : `HTTP ${r.status}`,
      };
    }),
  );
  checks.push(
    await one("finance", "GET :3006 /health", async () => {
      const r = await get(3006, "/health");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("trust", "GET :3007 /health", async () => {
      const r = await get(3007, "/health");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );
  checks.push(
    await one("govern", "GET :3008 /health", async () => {
      const r = await get(3008, "/health");
      return { ok: r.status === 200, detail: `HTTP ${r.status}` };
    }),
  );

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.target})`);
  const result = { ok: failures.length === 0, checked_at: new Date().toISOString(), failures, checks };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

void main();
