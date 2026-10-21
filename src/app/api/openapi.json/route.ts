// GET /api/openapi.json — OpenAPI 3.1 description of the governed public API v1
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Tengasell Public API",
    version: "1.0.0",
    summary: "Read-only governed developer surface for Tengasell marketplace data.",
    description:
      "Tengasell exposes a governed read-only API for listings data. " +
      "Authentication uses bearer API keys created in the developer console. " +
      "Every response carries an X-Request-Id header; include it in support requests. " +
      "Rate limits are enforced per key (default 60 req/min, max 120) — a 429 response includes Retry-After. " +
      "Errors use the envelope {ok:false, error:{message, code}}. " +
      "Usage is subject to the Developer API Terms (policy key 'api-terms').",
    contact: { name: "Tengasell Developer Relations", email: "developers@tengasell.co.zw" },
    license: { name: "Tengasell API Terms", url: "/policy/api-terms" },
  },
  servers: [{ url: "/", description: "Same-origin gateway" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "listings", description: "Public marketplace listings (read-only)" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key in the form `tga_live_xxxxxxxx.<secret>` — created in the developer console. Shown once at creation.",
      },
    },
    schemas: {
      Envelope: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
          data: {},
          requestId: { type: "string", description: "Echoed as the X-Request-Id response header." },
        },
      },
      Error: {
        type: "object",
        properties: {
          ok: { const: false },
          error: {
            type: "object",
            properties: {
              message: { type: "string" },
              code: { type: "integer", description: "HTTP status code" },
            },
          },
          requestId: { type: "string" },
        },
      },
      ListingSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          condition: { type: "string", enum: ["NEW", "USED", "REFURB"] },
          type: { type: "string", enum: ["AUCTION", "BUY_NOW"] },
          currentPrice: { type: "number" },
          buyNowPrice: { type: "number", nullable: true },
          status: { type: "string", enum: ["ACTIVE", "ENDED", "SOLD"] },
          endsAt: { type: "string", format: "date-time", nullable: true },
          bidCount: { type: "integer" },
          watchCount: { type: "integer" },
          category: { $ref: "#/components/schemas/Category" },
          seller: { $ref: "#/components/schemas/Seller" },
          images: { type: "array", items: { type: "string" } },
        },
      },
      Category: {
        type: "object",
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
        },
      },
      Seller: {
        type: "object",
        description: "Public shop identity only — no personal data.",
        properties: {
          shopName: { type: "string" },
          slug: { type: "string" },
          ratingAvg: { type: "number" },
        },
      },
      BidAnonymised: {
        type: "object",
        description: "Bidder identity is masked (e.g. 'si***').",
        properties: {
          amount: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
          bidder: { type: "string" },
        },
      },
      ListingDetail: {
        allOf: [{ $ref: "#/components/schemas/ListingSummary" }],
        properties: {
          description: { type: "string" },
          startingPrice: { type: "number" },
          stock: { type: "integer" },
          viewCount: { type: "integer" },
          publishedAt: { type: "string", format: "date-time", nullable: true },
          bids: { type: "array", items: { $ref: "#/components/schemas/BidAnonymised" }, maxItems: 10 },
        },
      },
      ListingPage: {
        type: "object",
        properties: {
          ok: { const: true },
          data: {
            type: "object",
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/ListingSummary" } },
              total: { type: "integer" },
              page: { type: "integer" },
              limit: { type: "integer" },
            },
          },
          requestId: { type: "string" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid bearer key (401).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "Rate limit exceeded (429). Retry-After header included.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        headers: { "Retry-After": { schema: { type: "string" }, description: "Seconds until the window resets." } },
      },
      NotFound: {
        description: "Resource not found or not publicly visible (404).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: {
    "/api/v1/listings": {
      get: {
        tags: ["listings"],
        summary: "Search published listings",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Free-text search on title/description." },
          { name: "category", in: "query", schema: { type: "string" }, description: "Category slug." },
          { name: "type", in: "query", schema: { type: "string", enum: ["AUCTION", "BUY_NOW"] } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "ending", "price_asc", "price_desc"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          200: {
            description: "Paginated listings.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ListingPage" } } },
            headers: { "X-Request-Id": { schema: { type: "string" } } },
          },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/v1/listings/{id}": {
      get: {
        tags: ["listings"],
        summary: "Listing detail with top 10 anonymised bids",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Public listing detail.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { const: true },
                    data: { $ref: "#/components/schemas/ListingDetail" },
                    requestId: { type: "string" },
                  },
                },
              },
            },
            headers: { "X-Request-Id": { schema: { type: "string" } } },
          },
          401: { $ref: "#/components/responses/Unauthorized" },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
  "x-tengasell": {
    auth: "Bearer tga_live_xxxxxxxx.<secret>",
    rateLimit: "Per-key, requests per rolling 60s (key ratePerMin, max 120). 429 responses include Retry-After.",
    errorModel: "Every error is {ok:false, error:{message, code}} with X-Request-Id echoed.",
    webhooks: "Developers can register endpoints for bid.placed, order.paid, order.shipped, dispute.opened, auction.won (signed with whsec_ secret).",
    terms: "policy key 'api-terms' — no bulk scraping, no resale of data, keys revocable.",
  },
}

export async function GET() {
  return NextResponse.json(spec, {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
