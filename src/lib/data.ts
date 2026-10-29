import { db, table, type SyncTable } from './db';
import type { Base, Block, BlockKind, Bundle, Category, ExpenseCategory, PaymentMethod, Settings } from './types';

export const uid = () => crypto.randomUUID();

type Listener = () => void;
const listeners = new Set<Listener>();
/** 로컬 변경 알림 (동기화 예약용) */
export function onLocalChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

/** 저장: 즉시 IndexedDB에 쓰고 동기화 대상으로 표시 */
export async function put<T extends Base>(t: SyncTable, rec: Omit<T, 'updatedAt' | 'dirty'> & Partial<Base>): Promise<T> {
  const r = { ...rec, updatedAt: Date.now(), dirty: 1 } as unknown as T;
  await table(t).put(r);
  notify();
  return r;
}

export async function patch<T extends Base>(t: SyncTable, id: string, changes: Partial<T>) {
  const cur = await table(t).get(id);
  if (!cur) return;
  await put(t, { ...cur, ...changes });
}

/** 삭제: 다른 기기에도 전달되도록 표시만 남김 */
export async function remove(t: SyncTable, id: string) {
  const cur = await table(t).get(id);
  if (!cur) return;
  await put(t, { ...cur, deleted: 1 });
}

export const alive = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deleted);

export const DEFAULT_SECTIONS: Settings['sections'] = {
  top3: true, summary: true, stats: true, ledger: true, dailyReview: false, dday: false, goal: false,
};

export function withDefaults(s: Settings | undefined, nickname: string): Settings {
  return {
    id: 'me',
    updatedAt: 0,
    displayName: nickname,
    startScreen: 'timetable',
    aggregate: { categoryIds: [], bundleIds: [] },
    budget: 0,
    ...s,
    sections: { ...DEFAULT_SECTIONS, ...s?.sections },
  } as Settings;
}

export async function saveSettings(changes: Partial<Settings>, nickname: string) {
  const cur = withDefaults(await db.settings.get('me'), nickname);
  await put<Settings>('settings', { ...cur, ...changes });
}

/** 첫 실행 기본 데이터 */
export async function seedIfEmpty(nickname: string) {
  if ((await db.categories.count()) > 0 || (await db.settings.count()) > 0) return;
  const study: Category = { id: uid(), name: '공부', color: 'blue', order: 0, updatedAt: 0 };
  const job: Category = { id: uid(), name: '알바', color: 'yellow', order: 1, updatedAt: 0 };
  const gym: Category = { id: uid(), name: '운동', color: 'green', order: 2, updatedAt: 0 };
  for (const c of [study, job, gym]) await put('categories', c);
  const b = (categoryId: string, name: string, color: Bundle['color'], order: number, extra: Partial<Bundle> = {}) =>
    put<Bundle>('bundles', {
      id: uid(), categoryId, name, color, order, income: false, wage: 0, payday: 10, settleStart: 1, ...extra,
    });
  await b(study.id, '수학', 'blue', 0);
  await b(study.id, '영어', 'purple', 1);
  await b(job.id, '카페', 'yellow', 0, { income: true, wage: 10030, payday: 10 });
  await b(job.id, '과외', 'orange', 1, { income: true, wage: 25000, payday: 25 });
  await b(gym.id, '헬스', 'green', 0);
  const cats = [['식비', '#E8A16A'], ['카페', '#F2DC7A'], ['교통', '#9DD0EA'], ['쇼핑', '#EBA2B9'], ['생활', '#7ACB98'], ['기타', '#B9B9C0']];
  for (const [i, [name, color]] of cats.entries()) await put<ExpenseCategory>('expenseCategories', { id: uid(), name, color, order: i });
  for (const [i, name] of ['카드', '현금', '모바일페이'].entries()) await put<PaymentMethod>('paymentMethods', { id: uid(), name, order: i });
  await saveSettings({ aggregate: { categoryIds: [study.id], bundleIds: [] } }, nickname);
}

/** 집계 대상 묶음 id 집합 (카테고리 체크 시 하위 묶음 전체) */
export function aggregateBundleIds(settings: Settings, bundles: Bundle[]) {
  const set = new Set(settings.aggregate.bundleIds);
  for (const b of bundles) if (settings.aggregate.categoryIds.includes(b.categoryId)) set.add(b.id);
  return set;
}

/**
 * 블록 배치: 같은 날 같은 종류(PLAN/DONE)의 겹치는 블록은 잘라내거나 나눈다.
 */
export async function placeBlock(block: Omit<Block, 'updatedAt'>) {
  const others = alive(await db.blocks.where('date').equals(block.date).toArray()).filter(
    (b) => b.kind === block.kind && b.id !== block.id && b.start < block.end && b.end > block.start,
  );
  for (const o of others) {
    const left = o.start < block.start;
    const right = o.end > block.end;
    if (left && right) {
      await put<Block>('blocks', { ...o, end: block.start });
      await put<Block>('blocks', { ...o, id: uid(), start: block.end });
    } else if (left) {
      await put<Block>('blocks', { ...o, end: block.start });
    } else if (right) {
      await put<Block>('blocks', { ...o, start: block.end });
    } else {
      await remove('blocks', o.id);
    }
  }
  await put<Block>('blocks', block);
}

/** PLAN → DONE 복사: 이미 DONE이 있는 칸은 건드리지 않고 빈 칸만 채운다 */
export async function copyPlanToDone(date: string, only?: Block) {
  const all = alive(await db.blocks.where('date').equals(date).toArray());
  const filled = new Array<boolean>(144).fill(false);
  for (const b of all) if (b.kind === 'done') for (let s = b.start; s < b.end; s++) filled[s] = true;
  const plans = only ? [only] : all.filter((b) => b.kind === 'plan');
  let copied = 0;
  for (const p of plans) {
    let s = p.start;
    while (s < p.end) {
      if (filled[s]) { s++; continue; }
      let e = s;
      while (e < p.end && !filled[e]) e++;
      await put<Block>('blocks', { ...p, id: uid(), kind: 'done' as BlockKind, start: s, end: e, deleted: 0 });
      for (let i = s; i < e; i++) filled[i] = true;
      copied += e - s;
      s = e;
    }
  }
  return copied;
}

/** 로그아웃 시 이 기기 데이터 지우기 */
export async function clearLocalData() {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
