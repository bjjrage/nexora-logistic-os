export type Row = Record<string, any>;
export type SqlValue = string | number | bigint | null | Uint8Array;
export interface Database {
  readonly kind: 'sqlite' | 'postgres';
  all(sql: string, ...params: SqlValue[]): Promise<Row[]>;
  one(sql: string, ...params: SqlValue[]): Promise<Row | undefined>;
  run(sql: string, ...params: SqlValue[]): Promise<{ changes: number | bigint }>;
  transaction<T>(work: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}
