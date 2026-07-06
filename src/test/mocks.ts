/**
 * In-memory stand-in for the Supabase client, covering the query shapes the
 * repository (src/db.ts) actually uses. Test files wire it in with:
 *
 *   vi.mock('./supabase', async () => ({ supabase: (await import('./test/mocks')).supabaseMock }));
 *   vi.mock('./auth', async () => ({ currentUserId: (await import('./test/mocks')).currentUserIdMock }));
 *
 * Module caching guarantees the factory and the test see the same singleton state.
 */

type Row = Record<string, unknown>;

interface MockState {
  uid: string | null;
  tables: Record<string, Row[]>;
  /** storage path → blob */
  objects: Map<string, Blob>;
  /** one-shot injected failures, consumed on match */
  failures: { table: string; op: 'select' | 'insert' | 'update' | 'delete' }[];
  storageFailures: { method: 'upload' | 'remove' | 'download' }[];
  /** call log for asserting exact storage paths */
  uploads: string[];
  removals: string[];
  downloads: string[];
}

export const FAKE_UID = '11111111-2222-3333-4444-555555555555';

export const state: MockState = {
  uid: FAKE_UID,
  tables: {},
  objects: new Map(),
  failures: [],
  storageFailures: [],
  uploads: [],
  removals: [],
  downloads: [],
};

export function resetMock(uid: string | null = FAKE_UID): void {
  state.uid = uid;
  state.tables = {};
  state.objects = new Map();
  state.failures = [];
  state.storageFailures = [];
  state.uploads = [];
  state.removals = [];
  state.downloads = [];
}

export function rows(table: string): Row[] {
  return (state.tables[table] ??= []);
}

/** Make the next matching table operation fail with a PostgREST-style error. */
export function failNext(table: string, op: 'select' | 'insert' | 'update' | 'delete'): void {
  state.failures.push({ table, op });
}

export function failNextStorage(method: 'upload' | 'remove' | 'download'): void {
  state.storageFailures.push({ method });
}

export async function currentUserIdMock(): Promise<string | null> {
  return state.uid;
}

type Result = { data: unknown; error: { message: string } | null };

function takeFailure(table: string, op: 'select' | 'insert' | 'update' | 'delete'): boolean {
  const i = state.failures.findIndex((f) => f.table === table && f.op === op);
  if (i === -1) return false;
  state.failures.splice(i, 1);
  return true;
}

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private filters: [string, unknown][] = [];
  private orderBy: string | null = null;
  private returning = false;

  private table: string;

  constructor(table: string) {
    this.table = table;
  }

  select(_columns?: string): this {
    if (this.op === 'insert' || this.op === 'update') this.returning = true;
    else this.op = 'select';
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string): this {
    this.orderBy = column;
    return this;
  }

  async single(): Promise<Result> {
    const res = await this.execute();
    if (res.error) return res;
    const list = res.data as Row[];
    if (list.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    return { data: list[0], error: null };
  }

  async maybeSingle(): Promise<Result> {
    const res = await this.execute();
    if (res.error) return res;
    const list = res.data as Row[];
    return { data: list[0] ?? null, error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val);
  }

  private async execute(): Promise<Result> {
    if (takeFailure(this.table, this.op)) {
      return { data: null, error: { message: `injected ${this.op} failure on ${this.table}` } };
    }
    const table = rows(this.table);
    switch (this.op) {
      case 'select': {
        let out = table.filter((r) => this.matches(r));
        if (this.orderBy) {
          const col = this.orderBy;
          out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
        }
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      case 'insert': {
        const now = new Date().toISOString();
        const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({
          user_id: state.uid,
          created_at: now,
          updated_at: now,
          ...p,
        }));
        table.push(...inserted);
        return { data: this.returning ? inserted.map((r) => ({ ...r })) : null, error: null };
      }
      case 'update': {
        const updated: Row[] = [];
        for (const r of table) {
          if (this.matches(r)) {
            Object.assign(r, this.payload);
            updated.push({ ...r });
          }
        }
        return { data: this.returning ? updated : null, error: null };
      }
      case 'delete': {
        state.tables[this.table] = table.filter((r) => !this.matches(r));
        return { data: null, error: null };
      }
    }
  }
}

function takeStorageFailure(method: 'upload' | 'remove' | 'download'): boolean {
  const i = state.storageFailures.findIndex((f) => f.method === method);
  if (i === -1) return false;
  state.storageFailures.splice(i, 1);
  return true;
}

export const supabaseMock = {
  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  },
  storage: {
    from(_bucket: string) {
      return {
        async upload(path: string, blob: Blob, _opts?: unknown): Promise<Result> {
          state.uploads.push(path);
          if (takeStorageFailure('upload')) return { data: null, error: { message: 'injected upload failure' } };
          state.objects.set(path, blob);
          return { data: { path }, error: null };
        },
        async remove(paths: string[]): Promise<Result> {
          state.removals.push(...paths);
          if (takeStorageFailure('remove')) return { data: null, error: { message: 'injected remove failure' } };
          for (const p of paths) state.objects.delete(p);
          return { data: [], error: null };
        },
        async download(path: string): Promise<Result> {
          state.downloads.push(path);
          if (takeStorageFailure('download')) return { data: null, error: { message: 'injected download failure' } };
          const blob = state.objects.get(path);
          return blob ? { data: blob, error: null } : { data: null, error: { message: 'Object not found' } };
        },
      };
    },
  },
};
