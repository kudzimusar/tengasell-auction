// routes/registers.ts — the generic register engine + supporting registers.
//
//   GET    /admin/registers                      catalogue (names + counts)
//   GET    /admin/registers/:register            rows (strategy + compliance_
//   POST   /admin/registers/:register            create           calendar are
//   PATCH  /admin/registers/:register            update (id in body)  served from
//   DELETE /admin/registers/:register?id=        delete           their tables)
//   GET/POST/PATCH /admin/data-register          DAT-001..009 register
//   GET/POST/PATCH /admin/processors             processor register (PRV-014/015)
//
// Row shape per register: {id, key, title, body, status, owner, due_date, meta}

import { HttpError, type AddRoute, bodyObj, bodyOptStr, bodyStr, parseJson } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";
import { DEDICATED, isRegister, REGISTERS } from "../registers-meta";

function serializeEntry(r: Record<string, unknown>) {
  return { ...r, meta: parseJson<unknown>(r.meta_json as string | null, null) };
}

function serializeCalendar(r: Record<string, unknown>) {
  return { ...r };
}

function serializeStrategy(r: Record<string, unknown>) {
  return { ...r };
}

export function registerRegisterRoutes(on: AddRoute): void {
  on("GET", "/admin/registers", () => {
    const counts: { name: string; count: number }[] = REGISTERS.map((name) => {
      if (name === "strategy") return { name, count: scalar(`SELECT COUNT(*) FROM strategy`) };
      if (name === "compliance_calendar") {
        return { name, count: scalar(`SELECT COUNT(*) FROM compliance_calendar`) };
      }
      return { name, count: scalar(`SELECT COUNT(*) FROM register_entries WHERE register = ?`, [name]) };
    });
    return { registers: counts };
  });

  // ── rows ─────────────────────────────────────────────────────────────────
  on("GET", "/admin/registers/:register", (ctx) => {
    const reg = ctx.params.register;
    if (!isRegister(reg)) throw new HttpError(404, `unknown register: ${reg}`, "unknown_register");

    if (reg === "strategy") {
      const rows = all(`SELECT id, key, title, body, owner, status FROM strategy ORDER BY id`);
      return { register: reg, rows: rows.map(serializeStrategy) };
    }
    if (reg === "compliance_calendar") {
      const status = ctx.url.searchParams.get("status");
      const rows = all(
        `SELECT id, obligation, jurisdiction, authority, due_date, status, filed_at, notes
         FROM compliance_calendar WHERE (? IS NULL OR status = ?) ORDER BY due_date`,
        [status, status],
      );
      return { register: reg, rows: rows.map(serializeCalendar) };
    }
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, register, key, title, body, status, owner, due_date, meta_json, created_at, updated_at
       FROM register_entries WHERE register = ? AND (? IS NULL OR status = ?)
       ORDER BY id`,
      [reg, status, status],
    );
    return { register: reg, rows: rows.map(serializeEntry) };
  });

  on("POST", "/admin/registers/:register", (ctx) => {
    ctx.requireAdmin();
    const reg = ctx.params.register;
    if (!isRegister(reg)) throw new HttpError(404, `unknown register: ${reg}`, "unknown_register");

    if (reg === "strategy") {
      const key = bodyStr(ctx, "key", { required: true, max: 60 });
      const id = insert(
        `INSERT OR REPLACE INTO strategy(key, title, body, owner, status) VALUES(?,?,?,?,?)`,
        [
          key,
          bodyStr(ctx, "title", { required: true, max: 200 }),
          bodyStr(ctx, "body", { required: true, max: 100_000 }),
          bodyStr(ctx, "owner", { max: 60 }) || "compliance",
          bodyStr(ctx, "status", { max: 30 }) || "active",
        ],
      );
      return { ok: true, id, register: reg };
    }
    if (reg === "compliance_calendar") {
      const id = insert(
        `INSERT INTO compliance_calendar(obligation, jurisdiction, authority, due_date, status, filed_at, notes)
         VALUES(?,?,?,?,?,?,?)`,
        [
          bodyStr(ctx, "obligation", { required: true, max: 300 }),
          bodyStr(ctx, "jurisdiction", { max: 100 }) || "Zimbabwe",
          bodyStr(ctx, "authority", { required: true, max: 120 }),
          bodyStr(ctx, "due_date", { required: true, max: 12 }),
          bodyStr(ctx, "status", { max: 20 }) || "upcoming",
          bodyOptStr(ctx, "filed_at"),
          bodyOptStr(ctx, "notes"),
        ],
      );
      return { ok: true, id, register: reg };
    }
    const meta = bodyObj(ctx, "meta");
    const id = insert(
      `INSERT INTO register_entries(register, key, title, body, status, owner, due_date, meta_json, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [
        reg,
        bodyOptStr(ctx, "key"),
        bodyStr(ctx, "title", { required: true, max: 300 }),
        bodyStr(ctx, "body", { max: 100_000 }),
        bodyStr(ctx, "status", { max: 40 }) || "active",
        bodyOptStr(ctx, "owner"),
        bodyOptStr(ctx, "due_date"),
        Object.keys(meta).length ? JSON.stringify(meta) : null,
      ],
    );
    return { ok: true, id, register: reg };
  });

  on("PATCH", "/admin/registers/:register", (ctx) => {
    ctx.requireAdmin();
    const reg = ctx.params.register;
    if (!isRegister(reg)) throw new HttpError(404, `unknown register: ${reg}`, "unknown_register");
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));

    if (reg === "strategy") {
      const cur = get(`SELECT * FROM strategy WHERE id = ?`, [id]);
      if (!cur) throw new HttpError(404, `strategy ${id} not found`, "not_found");
      run(
        `UPDATE strategy SET
           title = COALESCE(?, title), body = COALESCE(?, body),
           owner = COALESCE(?, owner), status = COALESCE(?, status)
         WHERE id = ?`,
        [
          bodyOptStr(ctx, "title"),
          bodyOptStr(ctx, "body"),
          bodyOptStr(ctx, "owner"),
          bodyOptStr(ctx, "status"),
          id,
        ],
      );
      return { ok: true, id };
    }
    if (reg === "compliance_calendar") {
      const cur = get(`SELECT * FROM compliance_calendar WHERE id = ?`, [id]);
      if (!cur) throw new HttpError(404, `calendar ${id} not found`, "not_found");
      const status = bodyOptStr(ctx, "status");
      const filedAt = bodyOptStr(ctx, "filed_at") ?? (status === "filed" ? nowSqlite() : null);
      run(
        `UPDATE compliance_calendar SET
           obligation = COALESCE(?, obligation), jurisdiction = COALESCE(?, jurisdiction),
           authority = COALESCE(?, authority), due_date = COALESCE(?, due_date),
           status = COALESCE(?, status), filed_at = COALESCE(?, filed_at),
           notes = COALESCE(?, notes)
         WHERE id = ?`,
        [
          bodyOptStr(ctx, "obligation"), bodyOptStr(ctx, "jurisdiction"), bodyOptStr(ctx, "authority"),
          bodyOptStr(ctx, "due_date"), status, filedAt, bodyOptStr(ctx, "notes"), id,
        ],
      );
      return { ok: true, id };
    }
    const cur = get(`SELECT id FROM register_entries WHERE register = ? AND id = ?`, [reg, id]);
    if (!cur) throw new HttpError(404, `entry ${id} not found in ${reg}`, "not_found");
    const meta = bodyObj(ctx, "meta");
    run(
      `UPDATE register_entries SET
         key = COALESCE(?, key), title = COALESCE(?, title), body = COALESCE(?, body),
         status = COALESCE(?, status), owner = COALESCE(?, owner), due_date = COALESCE(?, due_date),
         meta_json = CASE WHEN ? = 1 THEN ? ELSE meta_json END,
         updated_at = datetime('now')
       WHERE register = ? AND id = ?`,
      [
        bodyOptStr(ctx, "key"), bodyOptStr(ctx, "title"), bodyOptStr(ctx, "body"),
        bodyOptStr(ctx, "status"), bodyOptStr(ctx, "owner"), bodyOptStr(ctx, "due_date"),
        Object.keys(meta).length ? 1 : 0,
        Object.keys(meta).length ? JSON.stringify(meta) : null,
        reg, id,
      ],
    );
    return { ok: true, id };
  });

  on("DELETE", "/admin/registers/:register", (ctx) => {
    ctx.requireAdmin();
    const reg = ctx.params.register;
    if (!isRegister(reg)) throw new HttpError(404, `unknown register: ${reg}`, "unknown_register");
    const id = Number(ctx.url.searchParams.get("id") ?? "0");
    if (!id) throw new HttpError(400, "id query param required", "missing_field");
    if (reg === "strategy") {
      run(`DELETE FROM strategy WHERE id = ?`, [id]);
    } else if (reg === "compliance_calendar") {
      run(`DELETE FROM compliance_calendar WHERE id = ?`, [id]);
    } else {
      run(`DELETE FROM register_entries WHERE register = ? AND id = ?`, [reg, id]);
    }
    return { ok: true, id };
  });

  // ── data register (DAT-001..009) ─────────────────────────────────────────
  on("GET", "/admin/data-register", (ctx) => {
    const category = ctx.url.searchParams.get("category");
    const rows = all(
      `SELECT id, asset, store, category, purpose, legal_basis, owner, retention, retention_days, processing_notes, notes
       FROM data_register WHERE (? IS NULL OR category = ?) ORDER BY id`,
      [category, category],
    );
    return { rows };
  });

  on("POST", "/admin/data-register", (ctx) => {
    ctx.requireAdmin();
    const id = insert(
      `INSERT INTO data_register(asset, store, category, purpose, legal_basis, owner, retention, retention_days, processing_notes, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        bodyStr(ctx, "asset", { required: true, max: 200 }),
        bodyStr(ctx, "store", { required: true, max: 200 }),
        bodyStr(ctx, "category", { required: true, max: 20 }),
        bodyStr(ctx, "purpose", { required: true, max: 1000 }),
        bodyStr(ctx, "legal_basis", { required: true, max: 300 }),
        bodyStr(ctx, "owner", { required: true, max: 60 }),
        bodyStr(ctx, "retention", { required: true, max: 200 }),
        bodyOptStr(ctx, "retention_days") ? Number(bodyStr(ctx, "retention_days")) : null,
        bodyOptStr(ctx, "processing_notes"),
        bodyOptStr(ctx, "notes"),
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/data-register", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM data_register WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `data register row ${id} not found`, "not_found");
    run(
      `UPDATE data_register SET
         asset = COALESCE(?, asset), store = COALESCE(?, store), category = COALESCE(?, category),
         purpose = COALESCE(?, purpose), legal_basis = COALESCE(?, legal_basis),
         owner = COALESCE(?, owner), retention = COALESCE(?, retention),
         retention_days = COALESCE(?, retention_days),
         processing_notes = COALESCE(?, processing_notes), notes = COALESCE(?, notes)
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "asset"), bodyOptStr(ctx, "store"), bodyOptStr(ctx, "category"),
        bodyOptStr(ctx, "purpose"), bodyOptStr(ctx, "legal_basis"), bodyOptStr(ctx, "owner"),
        bodyOptStr(ctx, "retention"),
        bodyOptStr(ctx, "retention_days") ? Number(bodyStr(ctx, "retention_days")) : null,
        bodyOptStr(ctx, "processing_notes"), bodyOptStr(ctx, "notes"), id,
      ],
    );
    return { ok: true, id };
  });

  // ── processor register (PRV-014/015, PRT-011, RSK-008) ───────────────────
  on("GET", "/admin/processors", () => {
    const rows = all(
      `SELECT id, name, role, location, data_categories, transfer_basis, risk_notes, contract_status, review_due
       FROM processors ORDER BY id`,
    );
    return { processors: rows };
  });

  on("POST", "/admin/processors", (ctx) => {
    ctx.requireAdmin();
    const id = insert(
      `INSERT INTO processors(name, role, location, data_categories, transfer_basis, risk_notes, contract_status, review_due)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        bodyStr(ctx, "name", { required: true, max: 200 }),
        bodyStr(ctx, "role", { required: true, max: 300 }),
        bodyStr(ctx, "location", { required: true, max: 200 }),
        bodyStr(ctx, "data_categories", { required: true, max: 500 }),
        bodyOptStr(ctx, "transfer_basis"),
        bodyOptStr(ctx, "risk_notes"),
        bodyStr(ctx, "contract_status", { max: 40 }) || "active",
        bodyOptStr(ctx, "review_due"),
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/processors", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM processors WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `processor ${id} not found`, "not_found");
    run(
      `UPDATE processors SET
         name = COALESCE(?, name), role = COALESCE(?, role), location = COALESCE(?, location),
         data_categories = COALESCE(?, data_categories), transfer_basis = COALESCE(?, transfer_basis),
         risk_notes = COALESCE(?, risk_notes), contract_status = COALESCE(?, contract_status),
         review_due = COALESCE(?, review_due)
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "name"), bodyOptStr(ctx, "role"), bodyOptStr(ctx, "location"),
        bodyOptStr(ctx, "data_categories"), bodyOptStr(ctx, "transfer_basis"),
        bodyOptStr(ctx, "risk_notes"), bodyOptStr(ctx, "contract_status"),
        bodyOptStr(ctx, "review_due"), id,
      ],
    );
    return { ok: true, id };
  });
}
