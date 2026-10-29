import { db, getMeta, setMeta, SYNC_TABLES, table, type SyncTable } from './db';
import { onLocalChange } from './data';
import { supabase } from './supabase';
import { getArtifactStore, type QuerySnap } from './artifactStore';

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

/* ---------- claude.ai 페이지 저장소 ---------- */

/** 저장소에 있는 항목의 최종 수정 시각 (push 때 더 새 것을 덮어쓰지 않으려고) */
const remoteUpdatedAt = new Map<string, number>();
let firstSnapshot: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
const itemKey = (t: string, id: string) => `${t}~${id}`;

async function applyRemote(snap: QuerySnap) {
  const changes = snap.docChanges().filter((c) => c.type !== 'removed');
  if (!changes.length) return;
  await db.transaction('rw', SYNC_TABLES.map((t) => table(t)), async () => {
    for (const c of changes) {
      const body = c.doc.data() as { tbl?: string; updatedAt?: number; data?: Record<string, unknown> } | undefined;
      if (!body?.tbl || !body.data || !(SYNC_TABLES as readonly string[]).includes(body.tbl)) continue;
      const at = Number(body.updatedAt) || 0;
      remoteUpdatedAt.set(c.doc.id, at);
      const t = table(body.tbl as SyncTable);
      const cur = await t.get(body.data.id as string);
      if (!cur || cur.updatedAt < at) await t.put({ ...body.data, dirty: 0 });
    }
  });
}

/** 다른 기기의 변경을 실시간으로 받는다 (처음 한 번 전체를 받은 뒤 resolve) */
function subscribeArtifact() {
  const st = getArtifactStore()!;
  firstSnapshot = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 8000);
    unsubscribe = st.items.onSnapshot(
      (snap) => {
        applyRemote(snap)
          .catch((e) => console.warn('apply failed', e))
          .finally(() => {
            if (!snap.metadata.fromCache) {
              clearTimeout(timeout);
              resolve();
            }
          });
      },
      (e) => {
        console.warn('store subscription ended', e);
        clearTimeout(timeout);
        setStatus('error');
        resolve();
      },
    );
  });
}

async function pushArtifact() {
  const st = getArtifactStore()!;
  for (const t of SYNC_TABLES) {
    const rows = await table(t).where('dirty').equals(1).toArray();
    for (const r of rows) {
      const key = itemKey(t, r.id);
      const { dirty: _d, ...data } = r;
      if ((remoteUpdatedAt.get(key) ?? -1) < r.updatedAt) {
        await st.items.doc(key).set({ tbl: t, updatedAt: r.updatedAt, deleted: !!r.deleted, data });
        remoteUpdatedAt.set(key, r.updatedAt);
      }
      const cur = await table(t).get(r.id);
      if (cur && cur.updatedAt === r.updatedAt) await table(t).update(r.id, { dirty: 0 });
    }
  }
}

async function runArtifact() {
  if (!firstSnapshot) subscribeArtifact();
  setStatus('syncing');
  try {
    await firstSnapshot;
    // 이전 버전에서 이 브라우저에만 저장했던 데이터를 처음 한 번 올린다
    if (!(await getMeta<boolean>('storeLinked'))) {
      for (const t of SYNC_TABLES) await table(t).toCollection().modify({ dirty: 1 });
      await setMeta('storeLinked', true);
    }
    await pushArtifact();
    setStatus('idle');
  } catch (e) {
    console.warn('sync failed', e);
    setStatus(navigator.onLine ? 'error' : 'offline');
  }
}

async function runOnce() {
  if (getArtifactStore()) return runArtifact();
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
  if (!supabase && !getArtifactStore()) return Promise.resolve();
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

/** 로그아웃: 다시 로그인하면 저장소 전체를 처음부터 받도록 구독을 끊는다 */
export function resetSyncState() {
  clearTimeout(timer);
  unsubscribe?.();
  unsubscribe = null;
  firstSnapshot = null;
  remoteUpdatedAt.clear();
}

export function startSync() {
  if ((!supabase && !getArtifactStore()) || started) return;
  started = true;
  setStatus('idle');
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
