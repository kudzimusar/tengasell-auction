// scripts/build-static-demo.mjs
//
// Builds the REAL TengaSell UI as a static site for GitHub Pages.
//
// Why this exists: the application is a client-rendered SPA (src/app/page.tsx
// mounts it with ssr:false). At boot, src/lib/tengasell/api/index.ts probes the
// TrailBase backend and, when unreachable, falls back to LocalStore — the
// app's own offline demo store seeded from src/data/seed.ts. So the genuine
// marketplace UI works with no server at all.
//
// Two blockers are handled here:
//   1. `output: "export"` cannot contain route handlers → src/app/api is moved
//      aside for the duration of the build and restored afterwards.
//   2. The UI references absolute asset paths (/brand/, /items/, /maplibre/),
//      which break on a project Pages URL (/tengasell-auction/). Built JS/HTML
//      is rewritten to include the base path.
//
// Usage: node scripts/build-static-demo.mjs --base-path=/tengasell-auction

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src", "app", "api");
const API_STASH = path.join(ROOT, ".static-demo-api-stash");
const OUT = path.join(ROOT, "out");

const baseArg = process.argv.find((a) => a.startsWith("--base-path="));
const BASE_PATH = baseArg ? baseArg.split("=")[1].replace(/\/$/, "") : "";
const ASSET_DIRS = ["brand", "items", "maplibre"];

function log(msg) {
  console.log(`[static-demo] ${msg}`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ── 1. Stash API routes ────────────────────────────────────────────────
if (!fs.existsSync(API_DIR)) {
  console.error("[static-demo] src/app/api not found — refusing to build a demo without the app");
  process.exit(1);
}
rmrf(API_STASH);
fs.renameSync(API_DIR, API_STASH);
log(`API routes stashed (${fs.readdirSync(API_STASH).length} entries) — export cannot include route handlers`);

let exitCode = 1;
try {
  rmrf(OUT);
  log(`building static export (basePath="${BASE_PATH || "/"}")`);
  const build = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        STATIC_DEMO: "1",
        STATIC_DEMO_BASE_PATH: BASE_PATH,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  exitCode = build.status ?? 1;
} finally {
  // ── 2. Always restore the API directory ──────────────────────────────
  rmrf(API_DIR);
  fs.renameSync(API_STASH, API_DIR);
  log("API routes restored");
}

if (exitCode !== 0) {
  console.error(`[static-demo] next build failed with exit code ${exitCode}`);
  process.exit(exitCode);
}
if (!fs.existsSync(OUT)) {
  console.error("[static-demo] out/ was not produced");
  process.exit(1);
}

// ── 3. Rewrite absolute asset paths for the Pages sub-path ─────────────
if (BASE_PATH) {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css|json|txt)$/.test(e.name)) files.push(p);
    }
  })(OUT);

  const prefixes = ASSET_DIRS.join("|");
  // Matches "/brand/…", '/items/…', url(/maplibre/…) — but never a path that
  // already contains the base path.
  const re = new RegExp(`(["'(])\\/(${prefixes})\\/`, "g");
  let rewritten = 0;
  let touched = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("/brand/") && !src.includes("/items/") && !src.includes("/maplibre/")) continue;
    const next = src.replace(re, (_m, pre, dir) => `${pre}${BASE_PATH}/${dir}/`);
    if (next !== src) {
      fs.writeFileSync(file, next);
      touched++;
      rewritten += (src.match(re) || []).length;
    }
  }
  log(`asset paths rewritten: ${rewritten} references across ${touched} files (prefix "${BASE_PATH}")`);
}

// ── 4. Sanity checks ──────────────────────────────────────────────────
const indexPath = path.join(OUT, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("[static-demo] out/index.html missing");
  process.exit(1);
}
const html = fs.readFileSync(indexPath, "utf8");
if (!/<div id="__next"|__next/.test(html)) {
  console.warn("[static-demo] warning: index.html has no __next root — check the app shell");
}
log(`static demo ready: out/ (${fs.readdirSync(OUT).length} top-level entries)`);
