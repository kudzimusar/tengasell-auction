import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { openSqliteDb } from "../src/lib/server/sqlite";

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
      const { resolveUserFromToken, resolveVerifiedSession } = await import("../src/lib/server/paynow-order");
      const nowSec = Math.floor(Date.now() / 1000);

      // 1. alg:none rejected without contacting TrailBase
      const noneJwt = makeJwt({ sub: "u1", username: "admin", admin: true, exp: nowSec + 300, iat: nowSec }, { alg: "none" });
      assert.equal(await resolveUserFromToken(`Bearer ${noneJwt}`), null);

      // 2. Expired token rejected
      const expiredJwt = makeJwt({ sub: "u1", username: "nyasha", admin: false, exp: nowSec - 5, iat: nowSec - 60 });
      assert.equal(await resolveUserFromToken(`Bearer ${expiredJwt}`), null);

      // 3. Missing iat claim fails closed
      const missingIatJwt = makeJwt({ sub: "u1", username: "nyasha", admin: false, exp: nowSec + 300 });
      responder = (tok) => ({ status: 200, body: { auth_token: tok } });
      assert.equal(await resolveUserFromToken(`Bearer ${missingIatJwt}`), null);

      // 4. HTTP 200 with auth_token: null fails closed (never falls back to caller token)
      const forgedJwt = makeJwt({ sub: "u1", username: "admin", admin: true, exp: nowSec + 300, iat: nowSec });
      responder = () => ({ status: 200, body: { auth_token: null, refresh_token: null } });
      assert.equal(await resolveUserFromToken(`Bearer ${forgedJwt}`), null);

      // 5. Mismatched identity returned by status fails closed
      const validUserJwt = makeJwt({ sub: "u1", username: "nyasha", admin: false, exp: nowSec + 300, iat: nowSec });
      const differentUserJwt = makeJwt({ sub: "u2", username: "admin", admin: true, exp: nowSec + 300, iat: nowSec });
      responder = () => ({ status: 200, body: { auth_token: differentUserJwt } });
      assert.equal(await resolveUserFromToken(`Bearer ${validUserJwt}`), null);

      // 6. Verified status token succeeds with canonical claims
      responder = (tok) => ({ status: 200, body: { auth_token: tok } });
      assert.deepEqual(await resolveUserFromToken(`Bearer ${validUserJwt}`), {
        username: "nyasha",
        admin: false,
        token: validUserJwt,
      });

      // 7. Canonical SQLite _user / _session / tgs_revocations.db checks + fail-closed session.db
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bff-canon-"));
      const revDbPath = path.join(dataDir, "tgs_revocations.db");
      const prevDataDir = process.env.TRAILBASE_DATA_DIR;
      const prevRevPath = process.env.TGS_REVOCATIONS_DB;
      const prevReqSess = process.env.TRAILBASE_REQUIRE_SESSION_DB;
      try {
        process.env.TRAILBASE_DATA_DIR = dataDir;
        process.env.TGS_REVOCATIONS_DB = revDbPath;
        process.env.TRAILBASE_REQUIRE_SESSION_DB = "1";

        const subB64 = Buffer.from(randomUUID().replace(/-/g, ""), "hex").toString("base64");
        const subBytes = Buffer.from(subB64, "base64");
        const userTok = makeJwt({ sub: subB64, username: "nyasha", admin: false, exp: nowSec + 600, iat: nowSec, mfa: true });

        const mdb = openSqliteDb(path.join(dataDir, "main.db"));
        mdb.exec("CREATE TABLE _user (id BLOB PRIMARY KEY, username TEXT NOT NULL, admin INTEGER NOT NULL)");
        mdb.prepare("INSERT INTO _user (id, username, admin) VALUES (?, ?, ?)").run(subBytes, "nyasha", 1);

        // Missing session.db -> fails closed!
        assert.equal(await resolveVerifiedSession(`Bearer ${userTok}`), null);

        // With active _session -> succeeds and uses canonical admin=1 from _user & mfa=true from status
        const sdb = openSqliteDb(path.join(dataDir, "session.db"));
        sdb.exec("CREATE TABLE _session (id BLOB PRIMARY KEY, user BLOB NOT NULL, refresh_token TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)");
        sdb.prepare("INSERT INTO _session (id, user, refresh_token, created, expires) VALUES (?, ?, ?, ?, ?)").run(
          Buffer.from(randomUUID().replace(/-/g, ""), "hex"),
          subBytes,
          "r1",
          nowSec,
          nowSec + 86400,
        );
        const sess = await resolveVerifiedSession(`Bearer ${userTok}`);
        assert.deepEqual(sess, {
          sub: subB64,
          username: "nyasha",
          admin: true,
          mfa: true,
          iat: nowSec,
          token: userTok,
        });

        // Durable token revocation blocks token immediately while keeping other active tokens & canonical DB working
        const rdb = openSqliteDb(revDbPath);
        rdb.exec(`
          CREATE TABLE IF NOT EXISTS revoked_tokens (digest TEXT PRIMARY KEY, exp_ms INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS revoked_subjects (subject_key TEXT PRIMARY KEY, cutoff_sec INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
        `);
        const digest = createHash("sha256").update(userTok, "utf8").digest("hex");
        rdb.prepare("INSERT OR REPLACE INTO revoked_tokens (digest, exp_ms) VALUES (?, ?)").run(digest, (nowSec + 600) * 1000);
        assert.equal(await resolveVerifiedSession(`Bearer ${userTok}`), null);

        // Second non-revoked token for the same session still succeeds until subject revocation or _session deletion
        const userTok2 = makeJwt({ sub: subB64, username: "nyasha", admin: false, exp: nowSec + 600, iat: nowSec, jti: "2" });
        assert.ok(await resolveVerifiedSession(`Bearer ${userTok2}`));

        // Subject cutoff blocks userTok2 as well (<= nowSec)
        rdb.prepare("INSERT OR REPLACE INTO revoked_subjects (subject_key, cutoff_sec, updated_ms) VALUES (?, ?, ?)").run(
          `sub:${subB64}`,
          nowSec,
          Date.now(),
        );
        assert.equal(await resolveVerifiedSession(`Bearer ${userTok2}`), null);
        rdb.prepare("DELETE FROM revoked_subjects").run();
        assert.ok(await resolveVerifiedSession(`Bearer ${userTok2}`));

        // Deleting _session fails closed even without tgs_revocations.db entry
        sdb.prepare("DELETE FROM _session WHERE user = ?").run(subBytes);
        assert.equal(await resolveVerifiedSession(`Bearer ${userTok2}`), null);

        rdb.close();
        sdb.close();
        mdb.close();
      } finally {
        if (prevDataDir === undefined) delete process.env.TRAILBASE_DATA_DIR;
        else process.env.TRAILBASE_DATA_DIR = prevDataDir;
        if (prevRevPath === undefined) delete process.env.TGS_REVOCATIONS_DB;
        else process.env.TGS_REVOCATIONS_DB = prevRevPath;
        if (prevReqSess === undefined) delete process.env.TRAILBASE_REQUIRE_SESSION_DB;
        else process.env.TRAILBASE_REQUIRE_SESSION_DB = prevReqSess;
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});
