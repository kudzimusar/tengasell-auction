// routes/policies.ts — admin policy CMS: CRUD + editorial workflow.
//
// Workflow (CMS-005..029, LEG-001..010):
//   POST /admin/policies                     create policy or NEW draft version
//   POST /admin/policies/:key/submit         draft → in_review
//   POST /admin/policies/:key/approve        in_review → approved (actor recorded)
//   POST /admin/policies/:key/publish        approved → published ({at} = scheduled)
//   POST /admin/policies/:key/unpublish      published → retired (public 404s)
//   POST /admin/policies/:key/rollback       new version = copy of {toVersion},
//                                            published as a correction (CMS-019/020)
//   GET  /admin/policies                     list + acceptance counts
//   GET  /admin/policies/:key/versions       version history + audit trail
//   GET  /admin/policies/:key/preview/:ver   draft preview (CMS-029, admin only)
//   GET  /admin/acceptances                  acceptance records (filters)
//
// Publish authority is separated from authoring at the PROCESS level: every
// workflow step records its actor in content_audit (CMS-013/026).

import { HttpError, type AddRoute, bodyOptStr, bodyStr } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";

const KEYS = ["tos", "privacy", "rules", "seller", "aup", "refunds", "ip", "accessibility"] as const;
type PolicyKey = (typeof KEYS)[number];

function isKey(k: string): k is PolicyKey {
  return (KEYS as readonly string[]).includes(k);
}

function requirePolicy(key: string) {
  const p = get<{ id: number; key: string; status: string; current_version: number }>(
    `SELECT id, key, status, current_version FROM policies WHERE key = ?`,
    [key],
  );
  if (!p) throw new HttpError(404, `unknown policy: ${key}`, "unknown_policy");
  return p;
}

function nextVersion(key: string): number {
  const max = scalar(`SELECT COALESCE(MAX(version), 0) FROM policy_versions WHERE policy_key = ?`, [key]);
  return max + 1;
}

function audit(policyKey: string, action: string, version: number, actor: string, detail: string): void {
  run(
    `INSERT INTO content_audit(policy_key, action, version, actor, detail) VALUES(?,?,?,?,?)`,
    [policyKey, action, version, actor || "unknown", detail],
  );
}

function actor(ctx: { user: string | null; admin: boolean }): string {
  return ctx.user ?? (ctx.admin ? "admin" : "unknown");
}

export function registerPolicyRoutes(on: AddRoute): void {
  // ── list ─────────────────────────────────────────────────────────────────
  on("GET", "/admin/policies", () => {
    const policies = all<{
      key: string; title: string; title_ja: string; status: string;
      current_version: number; owner: string; scheduled_for: string | null; updated_at: string;
    }>(
      `SELECT key, title, title_ja, status, current_version, owner, scheduled_for, updated_at
       FROM policies ORDER BY key`,
    );
    const out = policies.map((p) => ({
      ...p,
      acceptances: scalar(`SELECT COUNT(*) FROM policy_acceptances WHERE policy_key = ?`, [p.key]),
      draft_versions: scalar(
        `SELECT COUNT(DISTINCT version) FROM policy_versions WHERE policy_key = ?`,
        [p.key],
      ),
    }));
    return { policies: out };
  });

  // ── create policy / new draft version ────────────────────────────────────
  on("POST", "/admin/policies", (ctx) => {
    ctx.requireAdmin();
    const by = actor(ctx);
    const key = bodyStr(ctx, "key", { required: true, max: 40 });
    if (!isKey(key)) throw new HttpError(400, `key must be one of: ${KEYS.join(", ")}`, "bad_key");
    const title = bodyStr(ctx, "title", { required: true, max: 200 });
    const titleJa = bodyStr(ctx, "title_ja", { required: true, max: 200 });
    const bodyEn = bodyStr(ctx, "body_en", { required: true, max: 200_000 });
    const bodyJa = bodyStr(ctx, "body_ja", { required: true, max: 200_000 });
    const effectiveFrom = bodyStr(ctx, "effective_from", { required: true, max: 12 });
    const changeNote = bodyStr(ctx, "change_note", { max: 2000 }) || "New draft.";
    const existing = get<{ status: string }>(`SELECT status FROM policies WHERE key = ?`, [key]);
    const version = nextVersion(key);

    if (!existing) {
      run(
        `INSERT INTO policies(key, title, title_ja, status, current_version, owner, updated_at)
         VALUES(?,?,?,'draft',?,?,datetime('now'))`,
        [key, title, titleJa, version, bodyOptStr(ctx, "owner") ?? "compliance"],
      );
    } else {
      // new draft version of an existing policy: only from a settled state
      if (existing.status === "in_review" || existing.status === "approved") {
        throw new HttpError(
          409,
          `policy ${key} is ${existing.status} — submit, approve/publish or roll back before drafting again`,
          "workflow_conflict",
        );
      }
      run(
        `UPDATE policies SET title = ?, title_ja = ?, status = 'draft', current_version = ?, updated_at = datetime('now')
         WHERE key = ?`,
        [title, titleJa, version, key],
      );
    }
    for (const [locale, body] of [["en", bodyEn], ["ja", bodyJa]] as const) {
      run(
        `INSERT OR REPLACE INTO policy_versions(policy_key, version, locale, body, effective_from, change_note, created_at, created_by)
         VALUES(?,?,?,?,?,?,datetime('now'),?)`,
        [key, version, locale, body, effectiveFrom, changeNote, by],
      );
    }
    audit(key, "draft", version, by, `created v${version} draft (${changeNote})`);
    return { ok: true, key, version, status: "draft" };
  });

  // ── workflow actions ─────────────────────────────────────────────────────
  const transition = (
      pattern: string,
      from: string[],
      to: string,
      actionName: string,
      extra?: (key: string, by: string) => void,
    ) =>
      on("POST", pattern, (ctx) => {
        ctx.requireAdmin();
        const key = ctx.params.key;
        const p = requirePolicy(key);
        if (!from.includes(p.status)) {
          throw new HttpError(409, `policy ${key} is ${p.status} — expected ${from.join("/")}`, "workflow_conflict");
        }
        run(`UPDATE policies SET status = ?, updated_at = datetime('now') WHERE key = ?`, [to, key]);
        audit(key, actionName, p.current_version, actor(ctx), `${p.status} → ${to}`);
        extra?.(key, actor(ctx));
        return { ok: true, key, status: to, version: p.current_version };
      });

    transition("/admin/policies/:key/submit", ["draft", "retired"], "in_review", "submit");
    transition("/admin/policies/:key/approve", ["in_review"], "approved", "approve");

    on("POST", "/admin/policies/:key/publish", (ctx) => {
      ctx.requireAdmin();
      const key = ctx.params.key;
      const p = requirePolicy(key);
      const by = actor(ctx);
      const at = bodyOptStr(ctx, "at"); // optional scheduled publish (ISO)
      if (at) {
        if (p.status !== "approved") {
          throw new HttpError(409, `scheduled publish requires approved status (is ${p.status})`, "workflow_conflict");
        }
        run(`UPDATE policies SET scheduled_for = ?, updated_at = datetime('now') WHERE key = ?`, [at, key]);
        audit(key, "schedule", p.current_version, by, `publish scheduled for ${at}`);
        return { ok: true, key, status: p.status, scheduled_for: at };
      }
      if (p.status !== "approved") {
        throw new HttpError(409, `policy ${key} is ${p.status} — approve before publishing`, "workflow_conflict");
      }
      const ts = nowSqlite();
      run(
        `UPDATE policy_versions SET published_at = ?, published_by = ? WHERE policy_key = ? AND version = ? AND published_at IS NULL`,
        [ts, by, key, p.current_version],
      );
      run(
        `UPDATE policies SET status = 'published', scheduled_for = NULL, updated_at = datetime('now') WHERE key = ?`,
        [key],
      );
      audit(key, "publish", p.current_version, by, `v${p.current_version} published at ${ts}`);
      return { ok: true, key, status: "published", version: p.current_version, published_at: ts };
    });

    on("POST", "/admin/policies/:key/unpublish", (ctx) => {
      ctx.requireAdmin();
      const key = ctx.params.key;
      const p = requirePolicy(key);
      if (p.status !== "published") {
        throw new HttpError(409, `policy ${key} is ${p.status} — only published policies can be unpublished`, "workflow_conflict");
      }
      run(`UPDATE policies SET status = 'retired', updated_at = datetime('now') WHERE key = ?`, [key]);
      audit(key, "unpublish", p.current_version, actor(ctx), `public page now returns not-published`);
      return { ok: true, key, status: "retired" };
    });

    on("POST", "/admin/policies/:key/rollback", (ctx) => {
      ctx.requireAdmin();
      const key = ctx.params.key;
      const p = requirePolicy(key);
      const by = actor(ctx);
      const toVersion = Number(bodyStr(ctx, "toVersion", { required: true }).slice(0, 8));
      const note = bodyStr(ctx, "note", { max: 2000 }) || `Rollback to v${toVersion} (correction).`;
      const source = get<{ body: string; effective_from: string; locale: string }>(
        `SELECT body, effective_from, locale FROM policy_versions WHERE policy_key = ? AND version = ? AND locale = 'en'`,
        [key, toVersion],
      );
      if (!source) throw new HttpError(404, `version ${toVersion} not found for ${key}`, "no_version");
      const sourceJa = get<{ body: string }>(
        `SELECT body FROM policy_versions WHERE policy_key = ? AND version = ? AND locale = 'ja'`,
        [key, toVersion],
      );
      const newVer = nextVersion(key);
      const ts = nowSqlite();
      for (const [locale, body] of [
        ["en", source.body],
        ["ja", sourceJa?.body ?? source.body],
      ] as const) {
        run(
          `INSERT OR REPLACE INTO policy_versions(policy_key, version, locale, body, effective_from, published_at, published_by, change_note, created_at, created_by)
           VALUES(?,?,?,?,?,?,?,?,datetime('now'),?)`,
          [key, newVer, locale, body, nowSqlite().slice(0, 10), ts, by, note, by],
        );
      }
      run(
        `UPDATE policies SET status = 'published', current_version = ?, scheduled_for = NULL, updated_at = datetime('now') WHERE key = ?`,
        [newVer, key],
      );
      audit(key, "rollback", newVer, by, `rollback to v${toVersion} → published as v${newVer} (${note})`);
      return { ok: true, key, version: newVer, rolled_back_to: toVersion, status: "published" };
    });

  // ── version history + audit trail ────────────────────────────────────────
  on("GET", "/admin/policies/:key/versions", (ctx) => {
    const key = ctx.params.key;
    requirePolicy(key);
    const versions = all<{
      version: number; locale: string; effective_from: string; published_at: string | null;
      published_by: string | null; change_note: string | null; created_at: string; created_by: string | null;
    }>(
      `SELECT version, locale, effective_from, published_at, published_by, change_note, created_at, created_by
       FROM policy_versions WHERE policy_key = ? ORDER BY version DESC, locale`,
      [key],
    );
    const auditTrail = all<{ id: number; action: string; version: number | null; actor: string | null; detail: string | null; created_at: string }>(
      `SELECT id, action, version, actor, detail, created_at FROM content_audit
       WHERE policy_key = ? ORDER BY id DESC LIMIT 100`,
      [key],
    );
    return { versions, audit: auditTrail };
  });

  // ── draft preview (CMS-029) ──────────────────────────────────────────────
  on("GET", "/admin/policies/:key/preview/:version", (ctx) => {
    const key = ctx.params.key;
    const version = Number(ctx.params.version);
    const locale = ctx.url.searchParams.get("locale") === "ja" ? "ja" : "en";
    requirePolicy(key);
    const row = get<{ body: string; effective_from: string; change_note: string | null; created_at: string; created_by: string | null }>(
      `SELECT body, effective_from, change_note, created_at, created_by FROM policy_versions
       WHERE policy_key = ? AND version = ? AND locale = ?`,
      [key, version, locale],
    );
    if (!row) throw new HttpError(404, `no v${version} (${locale}) for ${key}`, "no_version");
    const policy = get<{ title: string; title_ja: string; current_version: number }>(
      `SELECT title, title_ja, current_version FROM policies WHERE key = ?`,
      [key],
    );
    return {
      key,
      version,
      locale,
      preview: true,
      is_current: policy?.current_version === version,
      title: locale === "ja" ? policy?.title_ja : policy?.title,
      effective_from: row.effective_from,
      change_note: row.change_note,
      created_at: row.created_at,
      created_by: row.created_by,
      body: row.body,
    };
  });

  // ── acceptances (admin view) ─────────────────────────────────────────────
  on("GET", "/admin/acceptances", (ctx) => {
    const policyKey = ctx.url.searchParams.get("policy_key");
    const username = ctx.url.searchParams.get("username");
    const rows = all<{ id: number; policy_key: string; version: number; username: string | null; accepted_at: string; surface: string }>(
      `SELECT id, policy_key, version, username, accepted_at, surface FROM policy_acceptances
       WHERE (? IS NULL OR policy_key = ?) AND (? IS NULL OR username = ?)
       ORDER BY id DESC LIMIT 500`,
      [policyKey, policyKey, username, username],
    );
    return { acceptances: rows, count: rows.length };
  });
}
