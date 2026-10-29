import Dexie, { type Table } from 'dexie';
import type {
  Block, Bundle, Category, Expense, ExpenseCategory, PaymentMethod, Settings, Todo, Top3,
} from './types';

export interface Meta {
  key: string;
  value: unknown;
}

class BisjeDB extends Dexie {
  categories!: Table<Category, string>;
  bundles!: Table<Bundle, string>;
  todos!: Table<Todo, string>;
  top3!: Table<Top3, string>;
  blocks!: Table<Block, string>;
  expenses!: Table<Expense, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  paymentMethods!: Table<PaymentMethod, string>;
  settings!: Table<Settings, string>;
  /** 기기 전용 (동기화 안 함): 계정, 동기화 커서 등 */
  meta!: Table<Meta, string>;

  constructor() {
    super('bisje');
    this.version(1).stores({
      categories: 'id, dirty',
      bundles: 'id, categoryId, dirty',
      todos: 'id, bundleId, dirty',
      top3: 'id, dirty',
      blocks: 'id, date, dirty',
      expenses: 'id, date, dirty',
      expenseCategories: 'id, dirty',
      paymentMethods: 'id, dirty',
      settings: 'id, dirty',
      meta: 'key',
    });
  }
}

export const db = new BisjeDB();

export const SYNC_TABLES = [
  'categories', 'bundles', 'todos', 'top3', 'blocks',
  'expenses', 'expenseCategories', 'paymentMethods', 'settings',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export function table(name: SyncTable): Table<any, string> {
  return db[name] as Table<any, string>;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export async function delMeta(key: string) {
  await db.meta.delete(key);
}
