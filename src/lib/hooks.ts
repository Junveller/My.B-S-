import { createContext, useContext, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { alive, withDefaults } from './data';
import type { SessionInfo } from './auth';
import type { Block, Bundle, Category, Expense, ExpenseCategory, PaymentMethod, ScreenKey, Settings, Todo } from './types';
import { logicalToday } from './time';

export interface AppCtx {
  session: SessionInfo;
  settings: Settings;
  setSession: (s: SessionInfo | undefined) => void;
  go: (s: ScreenKey) => void;
  toast: (msg: string) => void;
  tablet: boolean;
  /** 할 일 · 시간표가 함께 보는 날짜 */
  date: string;
  setDate: (d: string) => void;
}
export const AppContext = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(AppContext);

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export function useCategories(): Category[] {
  return useLiveQuery(async () => alive(await db.categories.toArray()).sort(byOrder), [], []);
}
export function useBundles(): Bundle[] {
  return useLiveQuery(async () => alive(await db.bundles.toArray()).sort(byOrder), [], []);
}
export function useTodos(): Todo[] {
  return useLiveQuery(async () => alive(await db.todos.toArray()).sort(byOrder), [], []);
}
export function useExpenseCategories(): ExpenseCategory[] {
  return useLiveQuery(async () => alive(await db.expenseCategories.toArray()).sort(byOrder), [], []);
}
export function usePaymentMethods(): PaymentMethod[] {
  return useLiveQuery(async () => alive(await db.paymentMethods.toArray()).sort(byOrder), [], []);
}
export function useBlocksOn(date: string): Block[] {
  return useLiveQuery(async () => alive(await db.blocks.where('date').equals(date).toArray()), [date], []);
}
export function useBlocksBetween(from: string, to: string): Block[] {
  return useLiveQuery(async () => alive(await db.blocks.where('date').between(from, to, true, true).toArray()), [from, to], []);
}
export function useExpensesBetween(from: string, to: string): Expense[] {
  return useLiveQuery(async () => alive(await db.expenses.where('date').between(from, to, true, true).toArray()), [from, to], []);
}
export function useSettingsRaw(nickname: string): Settings | undefined {
  return useLiveQuery(async () => withDefaults(await db.settings.get('me'), nickname), [nickname]);
}

/** 현재 시각 (30초마다 갱신) */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useToday() {
  return logicalToday(useNow());
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}

/** 기기 전용 설정 (localStorage, 실패해도 기본값) */
export function useLocalPref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? init : (JSON.parse(raw) as T);
    } catch {
      return init;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* 무시 */
    }
  };
  return [v, set];
}
