import { createRequire } from "node:module";

export interface SqliteRunResult {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): SqliteRunResult;
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const runtimeRequire = createRequire(import.meta.url);

/**
 * Open a SQLite database using node:sqlite under Node.js (production/Next.js)
 * or bun:sqlite under Bun (local/CI security test suites).
 */
export function openSqliteDb(filePath: string, opts?: { readOnly?: boolean }): SqliteDb {
  if (typeof process !== "undefined" && process.versions?.bun) {
    const bunMod = "bun:sqlite";
    const { Database } = runtimeRequire(bunMod) as {
      Database: new (
        filePath: string,
        opts?: { readonly?: boolean; create?: boolean; readwrite?: boolean },
      ) => {
        exec(sql: string): void;
        prepare(sql: string): {
          get(...params: unknown[]): unknown;
          all(...params: unknown[]): unknown[];
          run(...params: unknown[]): SqliteRunResult;
        };
        close(): void;
      };
    };
    const db = new Database(
      filePath,
      opts?.readOnly ? { readonly: true } : { create: true, readwrite: true },
    );
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          get: (...params: unknown[]) => stmt.get(...params) ?? undefined,
          all: (...params: unknown[]) => stmt.all(...params),
          run: (...params: unknown[]) => stmt.run(...params) ?? {},
        };
      },
      close: () => db.close(),
    };
  }

  const nodeMod = "node:sqlite";
  const { DatabaseSync } = runtimeRequire(nodeMod) as {
    DatabaseSync: new (filePath: string, opts?: { readOnly?: boolean }) => SqliteDb;
  };
  return new DatabaseSync(filePath, opts?.readOnly ? { readOnly: true } : undefined);
}
