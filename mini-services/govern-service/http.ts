// HTTP plumbing shared by the govern-service router and route modules
// (mirrors comms-service/http.ts verbatim in behaviour).

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
  /** Parsed JSON body (POST/PUT/PATCH) or null. */
  body: Record<string, unknown> | null;
  /** Raw request text (unused by govern but kept for parity). */
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

export function bodyNum(ctx: Ctx, key: string, fallback?: number): number {
  const v = ctx.body?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${key} must be a number`, "bad_field");
  }
  return n;
}

export function bodyInt(ctx: Ctx, key: string, fallback?: number): number {
  return Math.trunc(bodyNum(ctx, key, fallback));
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

export function bodyArr(ctx: Ctx, key: string): unknown[] {
  const v = ctx.body?.[key];
  if (v == null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${key} must be an array`, "bad_field");
  return v;
}

/** Parse a JSON string column, tolerating null/blank/invalid values. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
