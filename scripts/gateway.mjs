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

// Only browser-facing upstreams may be addressed via ?XTransformPort.
const ALLOWED_TRANSFORM_PORTS = new Set([3001, 3002, 3004]);

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

function bestEffortRevokeOnLogout(bearerHeader) {
  const secret = (process.env.TGS_INTERNAL_SECRET || "").trim();
  if (!secret || typeof bearerHeader !== "string" || !bearerHeader.toLowerCase().startsWith("bearer ")) {
    return;
  }
  const token = bearerHeader.slice(7).trim();
  if (!token) return;
  const payload = JSON.stringify({ token });
  const req = http.request(
    {
      host: "127.0.0.1",
      port: 3002,
      method: "POST",
      path: "/internal/auth/revoke",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-tgs-internal": secret,
      },
      timeout: 3000,
    },
    (res) => res.resume(),
  );
  req.on("error", () => {});
  req.end(payload);
}

const server = http.createServer((req, res) => {
  const target = resolveTarget(req.url || "/");
  if (target.forbidden) {
    res.writeHead(target.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: target.error }));
    return;
  }
  const { port, path: targetPath, cleanPath } = target;
  if (process.env.GATEWAY_LOG === "1") {
    console.log(`[gateway] ${req.method} :${port} ${targetPath}`);
  }

  const proxied = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: targetPath,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (upstream) => {
      if (process.env.GATEWAY_LOG === "1") {
        console.log(`[gateway] ${req.method} :${port} ${targetPath} -> ${upstream.statusCode}`);
      }
      if (
        port === 3001 &&
        req.method === "POST" &&
        cleanPath === "/api/auth/v1/logout" &&
        upstream.statusCode &&
        upstream.statusCode < 400
      ) {
        bestEffortRevokeOnLogout(req.headers.authorization);
      }
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  proxied.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: `gateway: ${port} unreachable`,
        detail: err.code || err.message,
      }),
    );
  });

  req.pipe(proxied);
});

// WebSocket / HTTP upgrade (socket.io trade engine on 3002).
server.on("upgrade", (req, socket, head) => {
  const target = resolveTarget(req.url || "/");
  if (target.forbidden) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const { port, path: targetPath } = target;
  const upstream = net.connect(port, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => k.toLowerCase() !== "host")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${targetPath} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n${headers}\r\n\r\n`,
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(LISTEN, () => {
  console.log(`tengasell gateway on http://127.0.0.1:${LISTEN} → app :${APP_PORT}`);
  console.log(`  ?XTransformPort=3001 → Trailbase · 3002 trade engine · 3004 GIS`);
});
