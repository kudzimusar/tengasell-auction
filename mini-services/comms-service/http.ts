// HTTP plumbing shared by the router and route modules.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Parsed JSON body (POST/PUT) or null. */
  body: Record<string, unknown> | null;
  /** Raw request text — required for webhook signature verification. */
  rawBody: string | null;
  /** x-tgs-user header — username set by the Next BFF. */
  user: string | null;
  /** x-tgs-admin header === "1" — BFF asserts the caller is an admin. */
  admin: boolean;
  requireUser(): string;
  requireAdmin(): void;
}

export type RouteHandler = (ctx: Ctx) => unknown | Promise<unknown>;
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export type AddRoute = (method: Method, pattern: string, handler: RouteHandler) => void;

// ── Body field helpers (strict extraction from unknown JSON) ─────────────────

export function bodyStr(ctx: Ctx, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = ctx.body?.[key];
  // Accept strings + scalar primitives (e.g. numeric queueId) — coerce to string.
  const s =
    typeof v === "string"
      ? v
      : typeof v === "number" && Number.isFinite(v)
        ? String(v)
        : "";
  if (!s.trim()) {
    if (opts.required) throw new HttpError(400, `${key} is required`, "missing_field");
    return "";
  }
  const t = s.trim();
  return opts.max && t.length > opts.max ? t.slice(0, opts.max) : t;
}

export function bodyOptStr(ctx: Ctx, key: string): string | null {
  const v = ctx.body?.[key];
  if (typeof v !== "string" || !v.trim()) return null;
  return v.trim();
}

export function bodyObj(ctx: Ctx, key: string): Record<string, unknown> {
  const v = ctx.body?.[key];
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new HttpError(400, `${key} must be an object`, "bad_field");
  }
  return v as Record<string, unknown>;
}

export function bodyArr(ctx: Ctx, key: string): unknown[] {
  const v = ctx.body?.[key];
  if (v == null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${key} must be an array`, "bad_field");
  return v;
}
