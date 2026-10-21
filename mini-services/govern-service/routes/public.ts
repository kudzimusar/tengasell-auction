// routes/public.ts — PUBLIC endpoints (no auth headers required).
//
// GET  /public/policies        → published list {key,title,current_version,effective_from}
// GET  /public/policies/:key   → published body (?locale=ja falls back to en with
//                                {fallback:true}); 404-style body when not published
// POST /public/acceptances     → record an acceptance (anonymous null allowed;
//                                called from the policies page + signup/sell flows)

import { HttpError, type AddRoute, bodyStr, parseJson } from "../http";
import { all, get, insert, run, nowSqlite } from "../db";

interface PolicyRow {
  key: string;
  title: string;
  title_ja: string;
  status: string;
  current_version: number;
  owner: string;
  scheduled_for: string | null;
}

function publishedPolicy(key: string): PolicyRow | null {
  return get<PolicyRow>(
    `SELECT key, title, title_ja, status, current_version, owner, scheduled_for
     FROM policies WHERE key = ? AND status = 'published'`,
    [key],
  );
}

export function registerPublicRoutes(on: AddRoute): void {
  on("GET", "/public/policies", () => {
    const rows = all<PolicyRow>(
      `SELECT key, title, title_ja, status, current_version, owner, scheduled_for
       FROM policies WHERE status = 'published' ORDER BY key`,
    );
    const out = [];
    for (const p of rows) {
      const ver = get<{ effective_from: string }>(
        `SELECT effective_from FROM policy_versions
         WHERE policy_key = ? AND version = ? AND locale = 'en'`,
        [p.key, p.current_version],
      );
      out.push({
        key: p.key,
        title: p.title,
        title_ja: p.title_ja,
        current_version: p.current_version,
        effective_from: ver?.effective_from ?? null,
      });
    }
    return { policies: out };
  });

  on("GET", "/public/policies/:key", (ctx) => {
    const key = ctx.params.key;
    const policy = publishedPolicy(key);
    if (!policy) {
      throw new HttpError(404, `policy not published: ${key}`, "not_published");
    }
    const locale = ctx.url.searchParams.get("locale") === "ja" ? "ja" : "en";
    let version = get<{
      body: string; effective_from: string; published_at: string | null; change_note: string | null;
    }>(
      `SELECT body, effective_from, published_at, change_note FROM policy_versions
       WHERE policy_key = ? AND version = ? AND locale = ?`,
      [key, policy.current_version, locale],
    );
    let fallback = false;
    if (!version) {
      version = get(
        `SELECT body, effective_from, published_at, change_note FROM policy_versions
         WHERE policy_key = ? AND version = ? AND locale = 'en'`,
        [key, policy.current_version],
      );
      fallback = locale === "ja";
      if (!version) throw new HttpError(404, `no published version for ${key}`, "no_version");
    }
    return {
      key: policy.key,
      title: locale === "ja" ? policy.title_ja : policy.title,
      title_en: policy.title,
      title_ja: policy.title_ja,
      version: policy.current_version,
      locale,
      fallback,
      effective_from: version.effective_from,
      published_at: version.published_at,
      change_note: version.change_note,
      body: version.body,
    };
  });

  on("POST", "/public/acceptances", (ctx) => {
    const policyKey = bodyStr(ctx, "policy_key", { required: true, max: 40 });
    const version = Number(bodyStr(ctx, "version", { required: true }).slice(0, 8));
    const username = bodyStr(ctx, "username", { max: 60 }) || null;
    const surfaceRaw = bodyStr(ctx, "surface", { max: 20 }) || "policy_page";
    const surface = ["signup", "sell", "policy_page"].includes(surfaceRaw)
      ? surfaceRaw
      : "policy_page";
    const policy = get<{ key: string; current_version: number }>(
      `SELECT key, current_version FROM policies WHERE key = ?`,
      [policyKey],
    );
    if (!policy) throw new HttpError(404, `unknown policy: ${policyKey}`, "unknown_policy");
    const id = insert(
      `INSERT INTO policy_acceptances(policy_key, version, username, surface, accepted_at)
       VALUES(?,?,?,?,?)`,
      [policyKey, version, username, surface, nowSqlite()],
    );
    run(
      `INSERT INTO content_audit(policy_key, action, version, actor, detail)
       VALUES('acceptance','accept',?,?,?)`,
      [version, username ?? "anonymous", `surface=${surface} id=${id}`],
    );
    return { ok: true, id, policy_key: policyKey, version, username, surface };
  });
}
