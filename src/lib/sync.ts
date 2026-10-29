import { db, getMeta, setMeta, SYNC_TABLES, table, type SyncTable } from './db';
import { onLocalChange } from './data';
import { supabase } from './supabase';

/**
 * 서버 동기화
 * - 로컬 변경(dirty)을 push → 서버는 updated_at이 더 새로울 때만 덮어씀
 * - server_updated_at 커서 이후의 변경을 pull → 항목 단위로 최종 수정 시각이 더 새로운 쪽을 채택
 */
export type SyncStatus = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

let status: SyncStatus = supabase ? 'idle' : 'local';
const statusListeners = new Set<(s: SyncStatus) => void>();
const setStatus = (s: SyncStatus) => {
  status = s;
  statusListeners.forEach((fn) => fn(s));
};
export const getSyncStatus = () => status;
export function onSyncStatus(fn: (s: SyncStatus) => void) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const PULL_OVERLAP_MS = 5000;
const PAGE = 1000;

async function push() {
  for (const t of SYNC_TABLES) {
    const rows = await table(t).where('dirty').equals(1).toArray();
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const items = chunk.map(({ dirty: _d, ...data }) => ({
        tbl: t, id: data.id, data, updated_at: data.updatedAt, deleted: !!data.deleted,
      }));
      const { error } = await supabase!.rpc('push_records', { items });
      if (error) throw error;
      // 그 사이 다시 바뀐 항목은 dirty 유지
      await db.transaction('rw', table(t), async () => {
        for (const r of chunk) {
          const cur = await table(t).get(r.id);
          if (cur && cur.updatedAt === r.updatedAt) await table(t).update(r.id, { dirty: 0 });
        }
      });
    }
  }
}

async function pull() {
  let cursor = (await getMeta<string>('syncCursor')) ?? '1970-01-01T00:00:00Z';
  for (;;) {
    const since = new Date(new Date(cursor).getTime() - PULL_OVERLAP_MS).toISOString();
    const { data, error } = await supabase!
      .from('records')
      .select('tbl,id,data,updated_at,server_updated_at')
      .gt('server_updated_at', since)
      .order('server_updated_at')
      .limit(PAGE);
    if (error) throw error;
    if (!data.length) break;
    await db.transaction('rw', SYNC_TABLES.map((t) => table(t)), async () => {
      for (const r of data) {
        if (!(SYNC_TABLES as readonly string[]).includes(r.tbl)) continue;
        const t = table(r.tbl as SyncTable);
        const cur = await t.get(r.id);
        if (!cur || cur.updatedAt < Number(r.updated_at)) await t.put({ ...r.data, dirty: 0 });
      }
    });
    const last = data[data.length - 1].server_updated_at as string;
    const done = data.length < PAGE || last === cursor;
    cursor = last;
    await setMeta('syncCursor', cursor);
    if (done) break;
  }
}

async function runOnce() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  setStatus('syncing');
  try {
    await push();
    await pull();
    setStatus('idle');
  } catch (e) {
    console.warn('sync failed', e);
    setStatus(navigator.onLine ? 'error' : 'offline');
  }
}

export function syncNow(): Promise<void> {
  if (!supabase) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function flushSync() {
  clearTimeout(timer);
  await syncNow();
}

export function resetSyncState() {
  clearTimeout(timer);
}

export function startSync() {
  if (!supabase || started) return;
  started = true;
  onLocalChange(() => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else flushSync();
  });
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 60_000);
  syncNow();
}
