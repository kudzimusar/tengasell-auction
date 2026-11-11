import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

function b64Url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "EdDSA", typ: "JWT" },
  sig = "test-sig",
): string {
  return `${b64Url(header)}.${b64Url(payload)}.${sig}`;
}

describe("BFF resolveUserFromToken fail-closed auth", () => {
  it("rejects alg=none, expired, and 200 { auth_token: null } responses while accepting verified tokens", async () => {
    let responder: (token: string) => { status: number; body: unknown } = () => ({
      status: 200,
      body: { auth_token: null },
    });

    const srv = http.createServer((req, res) => {
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const out = responder(token);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });

    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
    const addr = srv.address();
    if (!addr || typeof addr === "string") throw new Error("Server failed to listen");
    process.env.TRAILBASE_URL = `http://127.0.0.1:${addr.port}`;

    try {
      const { resolveUserFromToken } = await import("../src/lib/server/paynow-order");
      const nowSec = Math.floor(Date.now() / 1000);

      // 1. alg:none rejected without contacting TrailBase
      const noneJwt = makeJwt({ sub: "u1", username: "admin", admin: true, exp: nowSec + 300 }, { alg: "none" });
      assert.equal(await resolveUserFromToken(`Bearer ${noneJwt}`), null);

      // 2. Expired token rejected
      const expiredJwt = makeJwt({ sub: "u1", username: "nyasha", admin: false, exp: nowSec - 5 });
      assert.equal(await resolveUserFromToken(`Bearer ${expiredJwt}`), null);

      // 3. HTTP 200 with auth_token: null fails closed (never falls back to caller token)
      const forgedJwt = makeJwt({ sub: "u1", username: "admin", admin: true, exp: nowSec + 300 });
      responder = () => ({ status: 200, body: { auth_token: null, refresh_token: null } });
      assert.equal(await resolveUserFromToken(`Bearer ${forgedJwt}`), null);

      // 4. Mismatched identity returned by status fails closed
      const validUserJwt = makeJwt({ sub: "u1", username: "nyasha", admin: false, exp: nowSec + 300 });
      const differentUserJwt = makeJwt({ sub: "u2", username: "admin", admin: true, exp: nowSec + 300 });
      responder = () => ({ status: 200, body: { auth_token: differentUserJwt } });
      assert.equal(await resolveUserFromToken(`Bearer ${validUserJwt}`), null);

      // 5. Verified status token succeeds with canonical claims
      responder = (tok) => ({ status: 200, body: { auth_token: tok } });
      assert.deepEqual(await resolveUserFromToken(`Bearer ${validUserJwt}`), {
        username: "nyasha",
        admin: false,
        token: validUserJwt,
      });
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});
