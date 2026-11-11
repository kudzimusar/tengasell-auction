// scripts/gateway.mjs — Caddy equivalent for local/production use without Caddy.
//
// The application is built around one public port. Every request carrying
// ?XTransformPort=<port> is reverse-proxied to that localhost port; everything
// else goes to the Next.js app. This mirrors the repo's Caddyfile:
//
//   :81 {
//     @transform_port_query { query XTransformPort=* }
//     handle @transform_port_query { reverse_proxy localhost:{query.XTransformPort} }
//     handle { reverse_proxy localhost:3000 }
//   }
//
// Ports used by TengaSell:
//   3000 Next.js app · 3001 Trailbase (Rust) · 3002 trade engine
//   3004 GIS · 3005 comms · 3006 finance · 3007 trust · 3008 govern
//
// Usage: node scripts/gateway.mjs [--port 8080] [--app 3000]

import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LISTEN = Number(argOf("--port", process.env.GATEWAY_PORT || 8080));
const APP_PORT = Number(argOf("--app", process.env.APP_PORT || 3000));
const TRAILBASE_PORT = Number(argOf("--trailbase", process.env.TRAILBASE_PORT || 3001));
const TRADE_PORT = Number(argOf("--trade", process.env.TRADE_PORT || 3002));

// Only browser-facing upstreams may be addressed via ?XTransformPort.
const ALLOWED_TRANSFORM_PORTS = new Set([3001, 3002, 3004]);

function mapUpstreamPort(logicalPort) {
  if (logicalPort === 3001) return TRAILBASE_PORT;
  if (logicalPort === 3002) return TRADE_PORT;
  return logicalPort;
}

function normalizePath(rawPath) {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const collapsed = decoded.replace(/\\/g, "/").replace(/\/+/g, "/");
  return path.posix.normalize(collapsed.startsWith("/") ? collapsed : `/${collapsed}`);
}

function resolveTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, "http://placeholder");
  } catch {
    return { forbidden: true, status: 400, error: "Malformed request URL" };
  }
  const normalizedPath = normalizePath(url.pathname);
  if (!normalizedPath) {
    return { forbidden: true, status: 400, error: "Malformed request path" };
  }
  if (normalizedPath === "/internal" || normalizedPath.startsWith("/internal/")) {
    return { forbidden: true, status: 403, error: "Internal endpoints are not publicly exposed" };
  }

  const transform = url.searchParams.get("XTransformPort");
  if (transform !== null && transform !== "") {
    if (!/^\d+$/.test(transform)) {
      return { forbidden: true, status: 403, error: "Forbidden transform port" };
    }
    const port = Number(transform);
    if (!ALLOWED_TRANSFORM_PORTS.has(port)) {
      return { forbidden: true, status: 403, error: "Forbidden transform port" };
    }
    if (normalizedPath === "/admin" || normalizedPath.startsWith("/admin/")) {
      return { forbidden: true, status: 403, error: "Admin endpoints are not exposed via transform port" };
    }
    url.searchParams.delete("XTransformPort");
    const qs = url.searchParams.toString();
    return {
      port,
      cleanPath: normalizedPath,
      path: url.pathname + (qs ? `?${qs}` : ""),
      isTransform: true,
    };
  }
  return { port: APP_PORT, cleanPath: normalizedPath, path: rawUrl, isTransform: false };
}

function decodeJwtExpMs(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return Date.now() + 24 * 3600_000;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof payload?.exp === "number" && Number.isFinite(payload.exp)
      ? Math.max(payload.exp * 1000, Date.now() + 60_000)
      : Date.now() + 24 * 3600_000;
  } catch {
    return Date.now() + 24 * 3600_000;
  }
}

async function recordTokenRevocationSqlite(token) {
  const dbPath =
    (process.env.TGS_REVOCATIONS_DB || "").trim() ||
    ((process.env.TRAILBASE_DATA_DIR || "").trim()
      ? path.join(process.env.TRAILBASE_DATA_DIR.trim(), "tgs_revocations.db")
      : "");
  if (!dbPath) return;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 2000;
        CREATE TABLE IF NOT EXISTS revoked_tokens (
          digest TEXT PRIMARY KEY,
          exp_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens (exp_ms);
      `);
      const digest = crypto.createHash("sha256").update(token).digest("hex");
      const expMs = Math.trunc(decodeJwtExpMs(token));
      db.prepare(
        "INSERT INTO revoked_tokens (digest, exp_ms) VALUES (?, ?) ON CONFLICT(digest) DO UPDATE SET exp_ms = MAX(revoked_tokens.exp_ms, excluded.exp_ms)",
      ).run(digest, expMs);
    } finally {
      db.close();
    }
  } catch {
    /* best-effort fallback when SQLite driver or directory is unavailable */
  }
}

async function bestEffortRevokeOnLogout(bearerHeader) {
  const raw = Array.isArray(bearerHeader) ? bearerHeader[0] : bearerHeader;
  if (typeof raw !== "string" || !raw.toLowerCase().startsWith("bearer ")) {
    return;
  }
  const token = raw.slice(7).trim();
  if (!token) return;

  await recordTokenRevocationSqlite(token);

  const secret = (process.env.TGS_INTERNAL_SECRET || "").trim();
  if (!secret) return;

  const payload = JSON.stringify({ token });
  await new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: TRADE_PORT,
        method: "POST",
        path: "/internal/auth/revoke",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-tgs-internal": secret,
        },
        timeout: 2500,
      },
      (res) => {
        res.resume();
        res.once("end", resolve);
        res.once("close", resolve);
        res.once("error", resolve);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.on("error", resolve);
    req.end(payload);
  });
}

const server = http.createServer((req, res) => {
  const target = resolveTarget(req.url || "/");
  if (target.forbidden) {
    res.writeHead(target.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: target.error }));
    return;
  }
  const { port, path: targetPath, cleanPath } = target;
  const upstreamPort = mapUpstreamPort(port);
  if (process.env.GATEWAY_LOG === "1") {
    console.log(`[gateway] ${req.method} :${upstreamPort} ${targetPath}`);
  }

  const proxied = http.request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: targetPath,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    (upstream) => {
      if (process.env.GATEWAY_LOG === "1") {
        console.log(`[gateway] ${req.method} :${upstreamPort} ${targetPath} -> ${upstream.statusCode}`);
      }
      const isLogout =
        port === 3001 &&
        (req.method === "GET" || req.method === "POST") &&
        cleanPath === "/api/auth/v1/logout" &&
        upstream.statusCode &&
        upstream.statusCode < 400;
      if (isLogout) {
        upstream.pause();
        void bestEffortRevokeOnLogout(req.headers.authorization).then(() => {
          if (res.writableEnded) {
            upstream.destroy();
            return;
          }
          res.writeHead(upstream.statusCode || 502, upstream.headers);
          upstream.pipe(res);
          upstream.resume();
        });
        return;
      }
      upstream.on("error", () => {
        if (!res.writableEnded) res.destroy();
      });
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  proxied.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: `gateway: ${upstreamPort} unreachable`,
          detail: err.code || err.message,
        }),
      );
    } else if (!res.writableEnded) {
      res.destroy();
    }
  });

  req.on("error", () => proxied.destroy());
  req.on("aborted", () => proxied.destroy());
  req.pipe(proxied);
});

// WebSocket / HTTP upgrade (socket.io trade engine on 3002).
server.on("upgrade", (req, socket, head) => {
  const target = resolveTarget(req.url || "/");
  if (target.forbidden) {
    socket.on("error", () => {});
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const { port, path: targetPath } = target;
  const upstreamPort = mapUpstreamPort(port);
  const upstream = net.connect(upstreamPort, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => k.toLowerCase() !== "host")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${targetPath} HTTP/1.1\r\nhost: 127.0.0.1:${upstreamPort}\r\n${headers}\r\n\r\n`,
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
});

server.listen(LISTEN, () => {
  console.log(`tengasell gateway on http://127.0.0.1:${LISTEN} → app :${APP_PORT}`);
  console.log(`  ?XTransformPort=3001 → Trailbase · 3002 trade engine · 3004 GIS`);
});
