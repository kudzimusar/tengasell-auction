import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function rawUpgradeStatus(host, port, requestPath) {
  return await new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => {
      sock.write(
        `GET ${requestPath} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buf = "";
    sock.setTimeout(2000, () => {
      sock.destroy();
      reject(new Error("WebSocket probe timed out"));
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\r\n")) {
        const line = buf.split("\r\n")[0];
        const code = Number(line.split(" ")[1]);
        sock.destroy();
        resolve(code);
      }
    });
    sock.on("error", reject);
  });
}

describe("gateway.mjs transform allowlist & internal-path hardening", () => {
  it("blocks disallowed ?XTransformPort targets, /internal/*, and transform /admin/* over HTTP and WebSocket", async () => {
    const stubApp = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise((resolve) => stubApp.listen(0, "127.0.0.1", resolve));
    const appAddr = stubApp.address();
    const appPort = typeof appAddr === "object" && appAddr ? appAddr.port : 0;
    const gwPort = await findFreePort();

    const gw = spawn("node", ["scripts/gateway.mjs", "--port", String(gwPort), "--app", String(appPort)], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Gateway startup timeout")), 4000);
        const onOut = (chunk) => {
          if (chunk.toString("utf8").includes("tengasell gateway on")) {
            clearTimeout(timer);
            resolve();
          }
        };
        gw.stdout.on("data", onOut);
        gw.stderr.on("data", onOut);
        gw.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Gateway exited early (${code})`));
        });
      });

      // Normal app traffic succeeds
      const okRes = await fetch(`http://127.0.0.1:${gwPort}/api/public/status`);
      assert.equal(okRes.status, 200);
      assert.deepEqual(await okRes.json(), { ok: true, path: "/api/public/status" });

      // Disallowed XTransformPort targets fail 403
      for (const badPath of [
        "/?XTransformPort=3006",
        "/?XTransformPort=3007",
        "/?XTransformPort=8080",
        "/?XTransformPort=abc",
        "/internal/auth/revoke?XTransformPort=3002",
        "/api/../internal/auth/revoke?XTransformPort=3002",
        "/%69nternal/auth/revoke?XTransformPort=3002",
        "/internal/trust/check",
        "/admin/status?XTransformPort=3002",
        "/%61dmin/ensure-dev?XTransformPort=3002",
      ]) {
        const res = await fetch(`http://127.0.0.1:${gwPort}${badPath}`);
        assert.equal(res.status, 403, `Expected 403 for ${badPath}, got ${res.status}`);
      }

      // Raw TCP WebSocket Upgrade attempts on blocked ports/paths return 403
      for (const wsPath of [
        "/socket.io/?XTransformPort=3007",
        "/internal/auth/revoke?XTransformPort=3002",
        "/admin/status?XTransformPort=3002",
      ]) {
        const statusCode = await rawUpgradeStatus("127.0.0.1", gwPort, wsPath);
        assert.equal(statusCode, 403, `Expected WS 403 for ${wsPath}, got ${statusCode}`);
      }
    } finally {
      gw.kill("SIGTERM");
      await new Promise((resolve) => gw.once("exit", resolve));
      await new Promise((resolve) => stubApp.close(resolve));
    }
  });
});
