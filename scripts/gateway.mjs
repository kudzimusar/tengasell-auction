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

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LISTEN = Number(argOf("--port", process.env.GATEWAY_PORT || 8080));
const APP_PORT = Number(argOf("--app", process.env.APP_PORT || 3000));

function resolveTarget(rawUrl) {
  const url = new URL(rawUrl, "http://placeholder");
  const transform = url.searchParams.get("XTransformPort");
  if (transform) {
    url.searchParams.delete("XTransformPort");
    const qs = url.searchParams.toString();
    return {
      port: Number(transform),
      path: url.pathname + (qs ? `?${qs}` : ""),
    };
  }
  return { port: APP_PORT, path: rawUrl };
}

const server = http.createServer((req, res) => {
  const { port, path } = resolveTarget(req.url || "/");

  const proxied = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (upstream) => {
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
  const { port, path } = resolveTarget(req.url || "/");
  const upstream = net.connect(port, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => k.toLowerCase() !== "host")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${path} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n${headers}\r\n\r\n`,
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(LISTEN, () => {
  console.log(`tengasell gateway on http://127.0.0.1:${LISTEN} → app :${APP_PORT}`);
  console.log(`  ?XTransformPort=3001 → Trailbase · 3002 trade engine · 3004 GIS …`);
});
