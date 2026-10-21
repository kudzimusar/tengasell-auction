// HTTP plumbing shared by the router and route modules (mirror comms http.ts).

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
  /** Parsed JSON body (POST/PUT/PATCH/DELETE) or null. */
  body: Record<string, unknown> | null;
  /** x-tgs-user header — username set by the Next BFF. */
  user: string | null;
  /** x-tgs-admin header === "1" — BFF asserts the caller is an admin. */
  admin: boolean;
  /** x-tgs-internal header — shared secret for /internal/* callers. */
  internal: boolean;
  requireUser(): string;
  requireAdmin(): string;
  requireInternal(): void;
}

export type RouteHandler = (ctx: Ctx) => unknown | Promise<unknown>;
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export type AddRoute = (method: Method, pattern: string, handler: RouteHandler) => void;

// ── Body field helpers (strict extraction from unknown JSON) ─────────────

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

export function bodyOptStr(ctx: Ctx, key: string, max?: number): string | null {
  const v = ctx.body?.[key];
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  return max && t.length > max ? t.slice(0, max) : t;
}

export function bodyInt(ctx: Ctx, key: string, opts: { required?: boolean } = {}): number | null {
  const v = ctx.body?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    if (opts.required) throw new HttpError(400, `${key} must be an integer`, "bad_field");
    return null;
  }
  return n;
}

export function bodyBool(ctx: Ctx, key: string): boolean {
  const v = ctx.body?.[key];
  return v === true || v === 1 || v === "1" || v === "true";
}

export function bodyObj(ctx: Ctx, key: string): Record<string, unknown> {
  const v = ctx.body?.[key];
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new HttpError(400, `${key} must be an object`, "bad_field");
  }
  return v as Record<string, unknown>;
}

/** Validate a body string against an allowed set (throws 400 on bad value). */
export function bodyEnum<T extends string>(ctx: Ctx, key: string, allowed: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T {
  const raw = bodyStr(ctx, key);
  if (!raw) {
    if (opts.fallback !== undefined) return opts.fallback;
    if (opts.required) throw new HttpError(400, `${key} is required`, "missing_field");
    throw new HttpError(400, `${key} is required`, "missing_field");
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new HttpError(400, `${key} must be one of: ${allowed.join(", ")}`, "bad_field");
  }
  return raw as T;
}
