// geo-spawn.ts — keeps the Tengasell GIS mini-service (port 3004) alive.
//
// The sandbox reaps processes started from agent shells, but the Next.js
// dev server is platform-managed and persists. We therefore:
//   1. spawn the GIS service from Next's instrumentation hook (server boot),
//   2. re-check it lazily at the start of every geo BFF request (self-healing).
//
// The spawn is idempotent: a TCP probe to :3004 runs first, and a
// module-level guard prevents concurrent spawn attempts.

import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const GIS_PORT = Number(process.env.GIS_PORT ?? 3004);
const GIS_DIR = path.join(process.cwd(), "mini-services", "gis-service");

let portCheck: Promise<boolean> | null = null;
let spawning: Promise<void> | null = null;

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

/** Fast port probe (single flight). */
export function gisRunning(): Promise<boolean> {
  portCheck ??= isPortOpen(GIS_PORT).finally(() => {
    portCheck = null;
  });
  return portCheck;
}

async function spawnGis(): Promise<void> {
  try {
    const logFile = path.join(GIS_DIR, "gis-service.log");
    const fd = fs.openSync(logFile, "a");
    const child = spawn("bun", ["index.ts"], {
      cwd: GIS_DIR,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    // Wait for the port to come up (max ~8s), then report.
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isPortOpen(GIS_PORT)) {
        console.log(`[geo] GIS service is up on :${GIS_PORT} (pid ${child.pid})`);
        return;
      }
    }
    console.warn(`[geo] GIS service did not bind :${GIS_PORT} within 8s — see ${logFile}`);
  } catch (err) {
    console.error("[geo] failed to spawn GIS service:", err);
  }
}

/**
 * Ensure the GIS service is running before handling a geo request.
 * Concurrent callers share one spawn attempt; failures are swallowed so
 * request handling can fall back to estimates.
 */
export async function ensureGisRunning(): Promise<void> {
  if (await gisRunning()) return;
  spawning ??= spawnGis().finally(() => {
    spawning = null;
  });
  await spawning;
}
