// tests/pi-trailbase-errors.test.ts
// Automated verification of TrailBase read-error correctness and 404 semantics.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import http from "node:http";
import { NextRequest } from "next/server";
import {
  TrailBaseError,
  statusToCode,
  tbGet,
  tbList,
  tbCreate,
  tbPatch,
  tbLogin,
  invalidateToken,
} from "../src/lib/server/trailbase-admin";
import { GET as searchGet } from "../src/app/api/pi/search/route";
import { POST as comparePost } from "../src/app/api/pi/compare/route";

describe("TrailBase Error Handling & 404 Semantics", () => {
  let server: http.Server;
  let serverPort: number;
  let originalEnv: Record<string, string | undefined>;
  let mockHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    originalEnv = {
      TRAILBASE_URL: process.env.TRAILBASE_URL,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    };

    server = http.createServer((req, res) => {
      if (req.url === "/api/auth/v1/login" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ auth_token: "mock-admin-token-xyz" }));
        return;
      }
      mockHandler(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    process.env.TRAILBASE_URL = `http://127.0.0.1:${serverPort}`;
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "test-admin-password";
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env.TRAILBASE_URL = originalEnv.TRAILBASE_URL;
    process.env.ADMIN_USERNAME = originalEnv.ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = originalEnv.ADMIN_PASSWORD;
  });

  beforeEach(() => {
    invalidateToken();
    process.env.TRAILBASE_URL = `http://127.0.0.1:${serverPort}`;
    process.env.ADMIN_PASSWORD = "test-admin-password";
  });

  it("statusToCode correctly maps standard HTTP error codes", () => {
    expect(statusToCode(400)).toBe("TRAILBASE_BAD_REQUEST");
    expect(statusToCode(401)).toBe("TRAILBASE_UNAUTHORIZED");
    expect(statusToCode(403)).toBe("TRAILBASE_FORBIDDEN");
    expect(statusToCode(404)).toBe("TRAILBASE_NOT_FOUND");
    expect(statusToCode(409)).toBe("TRAILBASE_CONFLICT");
    expect(statusToCode(429)).toBe("TRAILBASE_RATE_LIMITED");
    expect(statusToCode(502)).toBe("TRAILBASE_BAD_GATEWAY");
    expect(statusToCode(503)).toBe("TRAILBASE_UNAVAILABLE");
    expect(statusToCode(504)).toBe("TRAILBASE_GATEWAY_TIMEOUT");
    expect(statusToCode(500)).toBe("TRAILBASE_SERVER_ERROR");
  });

  it("fail-closed when ADMIN_PASSWORD is missing or blank", async () => {
    process.env.ADMIN_PASSWORD = "";
    expect(tbLogin()).rejects.toThrow(TrailBaseError);
    try {
      await tbLogin();
    } catch (err: any) {
      expect(err).toBeInstanceOf(TrailBaseError);
      expect(err.code).toBe("TRAILBASE_CONFIG_ERROR");
      expect(err.status).toBe(500);
    }
  });

  describe("tbGet", () => {
    it("returns record object when HTTP 200", async () => {
      mockHandler = (req, res) => {
        expect(req.headers.authorization).toBe("Bearer mock-admin-token-xyz");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: 42, title: "Live Toyota Hilux" }));
      };

      const result = await tbGet("auctions", 42);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(42);
      expect(result?.title).toBe("Live Toyota Hilux");
    });

    it("returns null on genuine HTTP 404 (not found)", async () => {
      mockHandler = (req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      };

      const result = await tbGet("auctions", 9999);
      expect(result).toBeNull();
    });

    it("throws TrailBaseError on HTTP 503 instead of masking as null", async () => {
      mockHandler = (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "service unavailable" }));
      };

      try {
        await tbGet("auctions", 42);
        expect(true).toBe(false); // should not reach
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(503);
        expect(err.code).toBe("TRAILBASE_UNAVAILABLE");
        expect(err.collection).toBe("auctions");
      }
    });

    it("throws TrailBaseError on HTTP 429 rate limit", async () => {
      mockHandler = (req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limit exceeded" }));
      };

      try {
        await tbGet("auctions", 42);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(429);
        expect(err.code).toBe("TRAILBASE_RATE_LIMITED");
      }
    });

    it("throws TrailBaseError(502, TRAILBASE_MALFORMED_JSON) on malformed response body", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Bad Gateway upstream HTML</body></html>");
      };

      try {
        await tbGet("auctions", 42);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(502);
        expect(err.code).toBe("TRAILBASE_MALFORMED_JSON");
      }
    });
  });

  describe("tbList", () => {
    it("returns records array on HTTP 200 with results", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ records: [{ id: 1 }, { id: 2 }] }));
      };

      const rows = await tbList("auctions", { limit: 10 });
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe(1);
    });

    it("returns empty array on genuine HTTP 200 empty result", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ records: [] }));
      };

      const rows = await tbList("auctions", { limit: 10 });
      expect(rows).toEqual([]);
    });

    it("throws TrailBaseError on HTTP 503 instead of masking as empty array", async () => {
      mockHandler = (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "database overloaded" }));
      };

      try {
        await tbList("product_search_index", { limit: 50 });
        expect(true).toBe(false); // must not return []
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(503);
        expect(err.code).toBe("TRAILBASE_UNAVAILABLE");
        expect(err.collection).toBe("product_search_index");
      }
    });

    it("throws TrailBaseError on HTTP 404 for collection listing", async () => {
      mockHandler = (req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "collection not found" }));
      };

      try {
        await tbList("non_existent_table", { limit: 10 });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(404);
        expect(err.code).toBe("TRAILBASE_NOT_FOUND");
      }
    });

    it("throws TrailBaseError on malformed JSON response for tbList", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Corrupted binary or HTML proxy response");
      };

      try {
        await tbList("product_search_index", { limit: 10 });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(502);
        expect(err.code).toBe("TRAILBASE_MALFORMED_JSON");
      }
    });
  });

  describe("tbCreate and tbPatch", () => {
    it("tbCreate returns created id on 200", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ids: [101] }));
      };

      const id = await tbCreate("vehicles", { make: "Nissan" });
      expect(id).toBe(101);
    });

    it("tbCreate throws TrailBaseError on HTTP 500", async () => {
      mockHandler = (req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "insert constraint violation" }));
      };

      expect(tbCreate("vehicles", { make: "Nissan" })).rejects.toThrow(TrailBaseError);
    });

    it("tbPatch returns true on 200 and throws on HTTP 503", async () => {
      mockHandler = (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      };

      const ok = await tbPatch("vehicles", 101, { model: "Navara" });
      expect(ok).toBe(true);

      mockHandler = (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "service unavailable" }));
      };

      expect(tbPatch("vehicles", 101, { model: "Navara" })).rejects.toThrow(TrailBaseError);
    });
  });

  describe("Network Unreachable", () => {
    it("throws TrailBaseError(503, TRAILBASE_UNAVAILABLE) when server port is unreachable", async () => {
      // Point to an unused local port
      process.env.TRAILBASE_URL = "http://127.0.0.1:59998";
      invalidateToken();

      try {
        await tbGet("auctions", 1);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrailBaseError);
        expect(err.status).toBe(503);
        expect(err.code).toBe("TRAILBASE_UNAVAILABLE");
      }
    });
  });

  describe("API Route Error Propagation (Search & Compare)", () => {
    it("GET /api/pi/search returns HTTP 503 SEARCH_UNAVAILABLE when TrailBase is down (never false empty 200)", async () => {
      mockHandler = (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "TrailBase search index database unavailable" }));
      };

      const req = new NextRequest("http://127.0.0.1:3000/api/pi/search?category=vehicles");
      const res = await searchGet(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe("SEARCH_UNAVAILABLE");
      expect(data.error).toBe("Search is temporarily unavailable.");
    });

    it("GET /api/pi/search returns HTTP 429 SEARCH_RATE_LIMITED when TrailBase is rate limited", async () => {
      mockHandler = (req, res) => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limit exceeded" }));
      };

      const req = new NextRequest("http://127.0.0.1:3000/api/pi/search?q=toyota");
      const res = await searchGet(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe("SEARCH_RATE_LIMITED");
    });

    it("POST /api/pi/compare returns HTTP 503 COMPARE_UNAVAILABLE when TrailBase is down (never false 404)", async () => {
      mockHandler = (req, res) => {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "TrailBase database down" }));
      };

      const req = new NextRequest("http://127.0.0.1:3000/api/pi/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionIds: [10, 20] }),
      });
      const res = await comparePost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe("COMPARE_UNAVAILABLE");
      expect(data.error).toBe("Product comparison is temporarily unavailable.");
    });

    it("POST /api/pi/compare returns HTTP 404 when listing is genuinely not found", async () => {
      mockHandler = (req, res) => {
        if (req.url?.includes("/api/records/v1/auctions/")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ records: [] }));
      };

      const req = new NextRequest("http://127.0.0.1:3000/api/pi/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionIds: [9999, 8888] }),
      });
      const res = await comparePost(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBe("COMPARE_LISTING_NOT_FOUND");
    });
  });
});
