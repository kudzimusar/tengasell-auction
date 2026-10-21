// HTTP plumbing shared by the router and route modules (mirrors comms).

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
  /** Raw request text — used for internal-token verification. */
  rawBody: string | null;
  /** x-tgs-user header — username set by the Next BFF. */
  user: string | null;
  /** x-tgs-admin header === "1" — BFF asserts the caller is an admin. */
  admin: boolean;
  requireUser(): string;
  requireAdmin(): void;
  /** Verify the shared internal service token (x-tgs-internal, §F). */
  requireInternal(): void;
}

export type RouteHandler = (ctx: Ctx) => unknown | Promise<unknown>;
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export type AddRoute = (method: Method, pattern: string, handler: RouteHandler) => void;

// ── Body field helpers (strict extraction from unknown JSON) ─────────────────

export function bodyStr(ctx: Ctx, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const v = ctx.body?.[key];
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

export function bodyOptStr(ctx: Ctx, key: string, max = 500): string | null {
  const v = ctx.body?.[key];
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

export function bodyArr(ctx: Ctx, key: string): unknown[] {
  const v = ctx.body?.[key];
  if (v == null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${key} must be an array`, "bad_field");
  return v;
}

export function bodyInt(ctx: Ctx, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number {
  const v = ctx.body?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) {
    if (opts.required) throw new HttpError(400, `${key} is required`, "missing_field");
    throw new HttpError(400, `${key} must be a number`, "bad_field");
  }
  const i = Math.round(n);
  if (opts.min != null && i < opts.min) throw new HttpError(400, `${key} must be ≥ ${opts.min}`, "bad_field");
  if (opts.max != null && i > opts.max) throw new HttpError(400, `${key} must be ≤ ${opts.max}`, "bad_field");
  return i;
}

export function bodyOptInt(ctx: Ctx, key: string): number | null {
  const v = ctx.body?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}
