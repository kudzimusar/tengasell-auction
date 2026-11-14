import type { VehicleStore } from "./vehicle-authority";

/**
 * Explicit operational read error thrown by the strict TrailBase store adapter.
 * Distinguishes upstream network/server failures (500, 502, 503, 429), authorization
 * failures (401, 403), and malformed response bodies from genuine record absence (404).
 */
export class TrailBaseReadError extends Error {
  constructor(
    public readonly table: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "TrailBaseReadError";
  }
}

export interface TrailBaseAdapterOptions {
  baseUrl: string;
  getAdminToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  searchFts?: (query: string) => Promise<number[] | null>;
}

/**
 * Creates an isolated, fail-closed TrailBase store adapter for Product Intelligence,
 * search indexing, and projection outbox consumption.
 *
 * Strict Read Semantics:
 * - HTTP 200 with `{ records: [...] }`: Returns valid array (including valid empty collection).
 * - HTTP 200 with record object: Returns record data.
 * - HTTP 404 for individual record: Returns `null` (genuine record absence).
 * - HTTP 404 for collection/table: Throws `TrailBaseReadError` (table missing).
 * - HTTP 401/403: Retries token refresh once; throws `TrailBaseReadError` if still rejected.
 * - HTTP 429: Throws `TrailBaseReadError` (rate limit).
 * - HTTP 500/502/503: Throws `TrailBaseReadError` (server error).
 * - Network drops or timeouts: Propagates thrown Error.
 * - Malformed response bodies: Throws `TrailBaseReadError` with status 200.
 */
export function createStrictTrailBaseStore(options: TrailBaseAdapterOptions): VehicleStore {
  const { baseUrl, getAdminToken, fetchImpl = fetch, timeoutMs = 8000, searchFts } = options;

  async function rawRequest(
    method: string,
    pathStr: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data: any }> {
    const call = async (token: string) => {
      const res = await fetchImpl(`${baseUrl}${pathStr}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        /* empty body (e.g. PATCH / DELETE / 204) */
      }
      return { ok: res.ok, status: res.status, data };
    };

    let token = await getAdminToken();
    let result = await call(token);
    if (result.status === 401 || result.status === 403) {
      token = await getAdminToken(true);
      result = await call(token);
    }
    return result;
  }

  async function strictGetRecords(table: string, paramsStr: string): Promise<any[]> {
    const query = paramsStr.startsWith("?") ? paramsStr.slice(1) : paramsStr;
    const url = query ? `/api/records/v1/${table}?${query}` : `/api/records/v1/${table}`;
    const res = await rawRequest("GET", url);

    if (!res.ok) {
      throw new TrailBaseReadError(
        table,
        res.status,
        `TrailBase GET ${url} failed with HTTP ${res.status}: ${JSON.stringify(res.data ?? "")}`,
        res.data,
      );
    }

    if (!res.data || typeof res.data !== "object" || !Array.isArray(res.data.records)) {
      throw new TrailBaseReadError(
        table,
        res.status,
        `TrailBase GET ${url} returned invalid or malformed response: missing records array`,
        res.data,
      );
    }

    return res.data.records;
  }

  async function strictGetRecord(table: string, id: number | string): Promise<any | null> {
    const url = `/api/records/v1/${table}/${id}`;
    const res = await rawRequest("GET", url);

    if (res.status === 404) {
      return null; // Genuine record absence
    }

    if (!res.ok) {
      throw new TrailBaseReadError(
        table,
        res.status,
        `TrailBase GET ${url} failed with HTTP ${res.status}: ${JSON.stringify(res.data ?? "")}`,
        res.data,
      );
    }

    if (res.data == null || typeof res.data !== "object" || Array.isArray(res.data)) {
      throw new TrailBaseReadError(
        table,
        res.status,
        `TrailBase GET ${url} returned invalid or malformed record data`,
        res.data,
      );
    }

    return res.data;
  }

  async function createRecord(table: string, row: unknown): Promise<number | null> {
    const res = await rawRequest("POST", `/api/records/v1/${table}`, row);
    if (!res.ok) {
      console.error(`[strictTrailBaseStore:createRecord] POST /api/records/v1/${table} failed (${res.status}):`, JSON.stringify(res.data));
    }
    const id = res.ok ? res.data?.ids?.[0] : null;
    return id != null ? Number(id) : null;
  }

  async function updateRecord(table: string, id: number | string, patch: unknown): Promise<boolean> {
    const res = await rawRequest("PATCH", `/api/records/v1/${table}/${id}`, patch);
    if (!res.ok) {
      console.error(`[strictTrailBaseStore:updateRecord] PATCH /api/records/v1/${table}/${id} failed (${res.status}):`, JSON.stringify(res.data));
    }
    return Boolean(res.ok);
  }

  async function deleteRecord(table: string, id: number | string): Promise<boolean> {
    const res = await rawRequest("DELETE", `/api/records/v1/${table}/${id}`);
    if (!res.ok) {
      console.error(`[strictTrailBaseStore:deleteRecord] DELETE /api/records/v1/${table}/${id} failed (${res.status}):`, JSON.stringify(res.data));
    }
    return Boolean(res.ok);
  }

  return {
    create: createRecord,
    get: strictGetRecord,
    list: strictGetRecords,
    update: updateRecord,
    remove: deleteRecord,
    searchFts,
  };
}
