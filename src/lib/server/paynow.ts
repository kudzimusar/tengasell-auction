// paynow.ts — Paynow (paynow.co.zw) Web Payments client, server-side only.
//
// Faithful implementation of the documented "Web Payments" interface:
//   1. initiateTransaction — POST form-urlencoded to
//      https://www.paynow.co.zw/interface/initiatetransaction with the
//      fields id, reference, amount, additionalinfo, returnurl, resulturl,
//      authemail, status ("Message"), optional method + phone (mobile
//      money). The response is a url-encoded form: status, browserurl,
//      redirecturl, pollurl, hash — the returned hash is VERIFIED before
//      the response is trusted.
//   2. pollStatus — GET {pollurl} returns a url-encoded body whose status
//      becomes "paid" | "awaiting delivery" (settled), "cancelled" |
//      "cancelled by user" | "disputed" | "failed" (terminal).
//   3. validateCallback — hash check for the fields Paynow POSTs to the
//      merchant resulturl webhook (the API route answers plain "OK").
//
// HASH ALGORITHM (Paynow-documented):
//   paynowHash(values, key):
//     1. concatenate the values in order
//     2. encodeURIComponent() the concatenation
//     3. append the integration key
//     4. MD5 hex digest, UPPERCASE
//
// MOCK / SANDBOX MODE — active whenever PAYNOW_INTEGRATION_ID or
// PAYNOW_INTEGRATION_KEY is absent: an adapter with the exact same response
// shapes and NO network calls. redirecturl points at our hosted sandbox
// page (#/pay/{reference}); the authoritative session state lives in the
// paynow_sessions TrailBase table (written by the /api/paynow/* routes),
// while an in-memory map keeps standalone pollStatus() calls in sync.
//
// Production env vars:
//   PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY,
//   PAYNOW_RETURN_URL (buyer return), PAYNOW_RESULT_URL (server webhook)

import { createHash } from "node:crypto";

const INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";

/** Fixed field order for initiate requests (Paynow spec). */
const INITIATE_FIELD_ORDER = [
  "id",
  "reference",
  "amount",
  "additionalinfo",
  "returnurl",
  "resulturl",
  "authemail",
  "status",
] as const;

/** Sandbox mode — activates when env credentials are absent. */
export function isMockMode(): boolean {
  return !process.env.PAYNOW_INTEGRATION_ID || !process.env.PAYNOW_INTEGRATION_KEY;
}

/** Mock credentials — only ever used to sign sandbox-mode responses. */
export const MOCK_INTEGRATION_ID = "1111";
export const MOCK_INTEGRATION_KEY = "Tengasell-Sandbox-Key";

function integrationId(): string {
  return isMockMode() ? MOCK_INTEGRATION_ID : String(process.env.PAYNOW_INTEGRATION_ID);
}

function integrationKey(): string {
  return isMockMode() ? MOCK_INTEGRATION_KEY : String(process.env.PAYNOW_INTEGRATION_KEY);
}

// ── hash ─────────────────────────────────────────────────────────────

/**
 * Paynow hash: concatenate `values` in order, encodeURIComponent the
 * concatenation, append the integration key, MD5, uppercase hex.
 */
export function paynowHash(values: string[], key: string): string {
  const concatenated = values.join("");
  const toSign = encodeURIComponent(concatenated) + key;
  return createHash("md5").update(toSign, "utf8").digest("hex").toUpperCase();
}

/**
 * Hash a field map (poll/callback/response payloads): every value EXCEPT
 * "hash", in the order the fields appear.
 */
function hashFields(fields: Record<string, string>, key: string): string {
  const values: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k.toLowerCase() === "hash") continue;
    values.push(v);
  }
  return paynowHash(values, key);
}

/** Parse a url-encoded form body, preserving field order (first wins). */
function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    if (k in out) continue;
    out[k] = v;
  }
  return out;
}

// ── initiate ──────────────────────────────────────────────────────────

export interface InitiateTransactionParams {
  reference: string;
  amount: number;
  additionalInfo: string;
  returnUrl: string;
  resultUrl: string;
  authEmail?: string;
  /** "ecocash" | "innbucks" — enables the mobile-money push flow. */
  method?: string;
  /** Buyer mobile number — required with method. */
  phone?: string;
}

export interface InitiateTransactionResult {
  ok: boolean;
  status: string;
  browserUrl: string;
  redirectUrl: string;
  pollUrl: string;
  error?: string;
  hash?: string;
  raw: Record<string, string>;
}

/**
 * Start a Paynow transaction (real gateway, or the sandbox adapter when
 * credentials are absent). The response hash is verified in real mode.
 */
export async function initiateTransaction(
  params: InitiateTransactionParams,
): Promise<InitiateTransactionResult> {
  if (isMockMode()) return mockInitiate(params);

  const fields: Record<string, string> = {
    id: integrationId(),
    reference: params.reference,
    amount: params.amount.toFixed(2),
    additionalinfo: params.additionalInfo,
    returnurl: params.returnUrl,
    resulturl: params.resultUrl,
    authemail: params.authEmail ?? "",
    status: "Message", // literal required by the web-payments spec
  };
  if (params.method) {
    fields.method = params.method;
    fields.phone = params.phone ?? "";
  }
  // request hash: the field VALUES in the fixed initiate order
  fields.hash = paynowHash(
    INITIATE_FIELD_ORDER.map((k) => fields[k] ?? ""),
    integrationKey(),
  );

  let res: Response;
  try {
    res = await fetch(INITIATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return {
      ok: false,
      status: "error",
      browserUrl: "",
      redirectUrl: "",
      pollUrl: "",
      error: "Could not reach Paynow — please retry.",
      raw: {},
    };
  }

  const raw = parseForm(await res.text().catch(() => ""));

  // verify the returned hash: all response values except "hash", in order
  if (raw.hash) {
    const expected = hashFields(raw, integrationKey());
    if (expected !== raw.hash.toUpperCase()) {
      return {
        ok: false,
        status: "error",
        browserUrl: "",
        redirectUrl: "",
        pollUrl: "",
        error: "Paynow response hash mismatch.",
        raw,
      };
    }
  }

  const ok = raw.status?.toLowerCase() === "ok";
  return {
    ok,
    status: raw.status ?? "",
    browserUrl: raw.browserurl ?? "",
    redirectUrl: raw.redirecturl ?? "",
    pollUrl: raw.pollurl ?? "",
    error: ok ? undefined : raw.error ?? "Paynow declined the transaction.",
    hash: raw.hash,
    raw,
  };
}

// ── poll ──────────────────────────────────────────────────────────────

export interface PollStatusResult {
  /** Normalized lowercase status. */
  status: string;
  /** "paid" | "awaiting delivery" — funds confirmed / in flight. */
  paid: boolean;
  cancelled: boolean;
  disputed: boolean;
  failed: boolean;
  paynowReference?: string;
  amount?: string;
  raw: Record<string, string>;
}

function isPaidStatus(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === "paid" || v === "awaiting delivery";
}

function isCancelledStatus(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === "cancelled" || v === "cancelled by user";
}

/** GET {pollUrl} → parsed url-encoded status (real gateway or sandbox). */
export async function pollStatus(pollUrl: string): Promise<PollStatusResult> {
  if (pollUrl.startsWith("mock://")) return mockPoll(pollUrl);

  let res: Response;
  try {
    res = await fetch(pollUrl, {
      method: "GET",
      headers: { Accept: "application/x-www-form-urlencoded, text/plain" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return {
      status: "error",
      paid: false,
      cancelled: false,
      disputed: false,
      failed: false,
      raw: {},
    };
  }
  const raw = parseForm(await res.text().catch(() => ""));
  const status = String(raw.status ?? "").trim().toLowerCase();
  return {
    status,
    paid: isPaidStatus(status),
    cancelled: isCancelledStatus(status),
    disputed: status === "disputed",
    failed: status === "failed",
    paynowReference: raw.paynowreference,
    amount: raw.amount,
    raw,
  };
}

// ── resulturl webhook ─────────────────────────────────────────────────

/**
 * Validate the hash of the fields Paynow POSTs to the resulturl. `fields`
 * must preserve the order they appeared in the form body.
 */
export function validateCallback(
  fields: Record<string, string>,
  key: string,
): boolean {
  const provided = fields.hash;
  if (!provided) return false;
  return hashFields(fields, key) === provided.toUpperCase();
}

// ── sandbox (mock) adapter — same shapes, no network ──────────────────

interface MockSession {
  reference: string;
  amount: number;
  status: string; // pending | paid | cancelled | failed
  pollUrl: string;
  redirectUrl: string;
}

const mockSessions = new Map<string, MockSession>();

function mockInitiate(params: InitiateTransactionParams): InitiateTransactionResult {
  const session: MockSession = {
    reference: params.reference,
    amount: params.amount,
    status: "pending",
    pollUrl: `mock://poll/${encodeURIComponent(params.reference)}`,
    redirectUrl: `#/pay/${encodeURIComponent(params.reference)}`, // our sandbox page
  };
  mockSessions.set(params.reference, session);

  // exact real-response shape (url-encoded semantics), hash-signed
  const raw: Record<string, string> = {
    status: "ok",
    browserurl: session.redirectUrl,
    redirecturl: session.redirectUrl,
    pollurl: session.pollUrl,
  };
  return {
    ok: true,
    status: "ok",
    browserUrl: session.redirectUrl,
    redirectUrl: session.redirectUrl,
    pollUrl: session.pollUrl,
    hash: hashFields(raw, MOCK_INTEGRATION_KEY),
    raw,
  };
}

function mockPoll(pollUrl: string): PollStatusResult {
  const reference = decodeURIComponent(pollUrl.replace(/^mock:\/\/poll\//, ""));
  const status = mockSessions.get(reference)?.status ?? "pending";
  return {
    status,
    paid: isPaidStatus(status),
    cancelled: isCancelledStatus(status) || status === "failed",
    disputed: status === "disputed",
    failed: status === "failed",
    paynowReference: reference,
    raw: { status, pollurl: pollUrl, reference },
  };
}

/** Keep the in-memory sandbox session in sync (called by the sandbox route). */
export function mockSetStatus(reference: string, status: string): void {
  const session = mockSessions.get(reference);
  if (session) session.status = status;
}
