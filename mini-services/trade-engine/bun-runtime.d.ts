declare module "bun:sqlite" {
  export class Statement<ReturnType = unknown, ParamsType extends unknown[] = unknown[]> {
    get(...params: ParamsType): ReturnType | null;
    all(...params: ParamsType): ReturnType[];
    run(...params: ParamsType): { changes: number; lastInsertRowid: number | bigint };
  }

  export class Database {
    constructor(
      filename?: string,
      options?: { readonly?: boolean; create?: boolean; readwrite?: boolean },
    );
    exec(sql: string): void;
    query<ReturnType = unknown, ParamsType extends unknown[] = unknown[]>(
      sql: string,
    ): Statement<ReturnType, ParamsType>;
    close(): void;
  }
}

declare module "bun:test" {
  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: () => void | Promise<void>, timeout?: number): void;
  export function beforeAll(fn: () => void | Promise<void>, timeout?: number): void;
  export function afterAll(fn: () => void | Promise<void>, timeout?: number): void;
  export function beforeEach(fn: () => void | Promise<void>, timeout?: number): void;
  export function afterEach(fn: () => void | Promise<void>, timeout?: number): void;
  export interface ExpectMatchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    not: ExpectMatchers;
    toMatchObject(expected: Record<string, unknown>): void;
    toHaveLength(expected: number): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toContain(expected: unknown): void;
  }
  export const expect: {
    (actual: unknown): ExpectMatchers;
    arrayContaining(arr: unknown[]): unknown;
  };
}
