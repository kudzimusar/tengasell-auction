// services-spawn.ts — keeps ALL Tengasell mini-services alive.
//
// The sandbox reaps processes started from agent shells, but the Next.js
// dev server is platform-managed and persists. We therefore spawn every
// mini-service from Next's instrumentation hook (server boot) and re-check
// them on a 60s watchdog inside the dev-server process tree:
//   · TrailBase (Rust backend)   :3001  — trail --depot ./traildepot run
//   · Trade engine (socket.io)   :3002  — bun --hot index.ts
//   · Comms service (TUCS)      :3005  — bun run dev (dev-comms.log)
// (GIS :3004 has its own lazy spawner in geo-spawn.ts, same pattern.)
//
// Each spawn is idempotent: a TCP probe runs first and a module-level guard
// prevents concurrent attempts — safe even if a manual daemon starter raced.

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME ?? "/home/z";
const PROJECT = process.cwd();

interface ServiceSpec {
  name: string;
  port: number;
  cwd: string;
  command: string;
  args: string[];
  /** Wait longer — TrailBase applies SQLite migrations on first boot. */
  bootTimeoutMs: number;
  /** Absolute log path override (defaults to <cwd>/<name>.log). */
  logFile?: string;
  /** Skip (and warn once) while the service folder does not exist yet. */
  requireDir?: boolean;
}

function trailBinary(): string {
  const candidates = [
    path.join(HOME, ".local/bin/trail"),
    "/home/z/.local/bin/trail",
    "trail",
  ];
  for (const c of candidates) {
    if (c === "trail") return "trail"; // fall back to PATH
    if (fs.existsSync(c)) return c;
  }
  return "trail";
}

const SERVICES: ServiceSpec[] = [
  {
    name: "trailbase",
    port: 3001,
    cwd: path.join(PROJECT, "mini-services", "trailbase-db"),
    command: trailBinary(),
    args: ["--depot", "./traildepot", "run", "--address", "0.0.0.0:3001"],
    bootTimeoutMs: 20_000,
  },
  {
    name: "trade-engine",
    port: 3002,
    cwd: path.join(PROJECT, "mini-services", "trade-engine"),
    command: "bun",
    args: ["--hot", "index.ts"],
    bootTimeoutMs: 15_000,
  },
  {
    // TUCS comms-service (Task 11-a) — user header x-tgs-user set by BFF.
    // Folder may not exist during parallel builds → requireDir skips
    // spawning (and the /api/comms/* routes return 503) until it lands.
    name: "comms-service",
    port: 3005,
    cwd: path.join(PROJECT, "mini-services", "comms-service"),
    command: "bun",
    args: ["run", "dev"],
    bootTimeoutMs: 15_000,
    logFile: path.join(PROJECT, "dev-comms.log"),
    requireDir: true,
  },
  {
    // MSCS 12-b finance-service — fees, ledger, escrow, payouts, refunds.
    name: "finance-service",
    port: 3006,
    cwd: path.join(PROJECT, "mini-services", "finance-service"),
    command: "bun",
    args: ["run", "dev"],
    bootTimeoutMs: 15_000,
    logFile: path.join(PROJECT, "dev-finance.log"),
    requireDir: true,
  },
  {
    // MSCS 12-c trust-service — support tickets, T&S, enforcement, roles.
    name: "trust-service",
    port: 3007,
    cwd: path.join(PROJECT, "mini-services", "trust-service"),
    command: "bun",
    args: ["run", "dev"],
    bootTimeoutMs: 15_000,
    logFile: path.join(PROJECT, "dev-trust.log"),
    requireDir: true,
  },
  {
    // MSCS 12-d govern-service — policies, privacy/DSAR, registers, MSCS
    // compliance register.
    name: "govern-service",
    port: 3008,
    cwd: path.join(PROJECT, "mini-services", "govern-service"),
    command: "bun",
    args: ["run", "dev"],
    bootTimeoutMs: 15_000,
    logFile: path.join(PROJECT, "dev-govern.log"),
    requireDir: true,
  },
];

const COMMS_SPEC = SERVICES.find((s) => s.name === "comms-service") as ServiceSpec;
const missingDirWarned = new Set<string>();

function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function spawnService(spec: ServiceSpec): Promise<void> {
  if (spec.requireDir && !fs.existsSync(spec.cwd)) {
    if (!missingDirWarned.has(spec.name)) {
      missingDirWarned.add(spec.name);
      console.warn(`[services] ${spec.name}: folder ${spec.cwd} does not exist yet — skipping spawn`);
    }
    return;
  }
  try {
    const logFile = spec.logFile ?? path.join(spec.cwd, `${spec.name}.log`);
    const fd = fs.openSync(logFile, "a");
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    for (let i = 0; i < Math.ceil(spec.bootTimeoutMs / 500); i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isPortOpen(spec.port)) {
        console.log(`[services] ${spec.name} is up on :${spec.port} (pid ${child.pid})`);
        return;
      }
    }
    console.warn(`[services] ${spec.name} did not bind :${spec.port} — see ${logFile}`);
  } catch (err) {
    console.error(`[services] failed to spawn ${spec.name}:`, err);
  }
}

const inflight = new Map<string, Promise<void>>();

/** Ensure one service is listening (single-flight, idempotent). */
export async function ensureService(spec: ServiceSpec): Promise<void> {
  if (await isPortOpen(spec.port)) return;
  let pending = inflight.get(spec.name);
  if (!pending) {
    pending = spawnService(spec).finally(() => inflight.delete(spec.name));
    inflight.set(spec.name, pending);
  }
  await pending;
}

/** Ensure ALL mini-services are listening. */
export async function ensureAllServices(): Promise<void> {
  await Promise.all(SERVICES.map((s) => ensureService(s)));
}

/** The TUCS comms-service spec (port 3005). */
export const commsServiceSpec: ServiceSpec = COMMS_SPEC;

/** Fast TCP probe: is the comms-service port bound? */
export function commsPortOpen(): Promise<boolean> {
  return isPortOpen(COMMS_SPEC.port);
}

/**
 * Health probe for the comms service (GET /health on :3005).
 * Returns true only when the service answers with a 200.
 */
export async function commsHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${COMMS_SPEC.port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the comms service is healthy, lazily spawning it when the port is
 * down. Returns whether /health answers — the BFF routes 503 otherwise.
 */
export async function ensureCommsService(): Promise<boolean> {
  if (await commsHealthy()) return true;
  await ensureService(COMMS_SPEC);
  return commsHealthy();
}

let watchdogStarted = false;

/**
 * Boot-time ensure + a 60s watchdog so mid-session crashes self-heal.
 * Runs inside the persistent dev-server process tree.
 */
export function startServicesWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  void ensureAllServices();
  setInterval(() => {
    void ensureAllServices();
  }, 60_000).unref?.();
}
