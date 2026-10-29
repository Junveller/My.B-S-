/**
 * claude.ai 페이지로 열었을 때의 저장소 (`db` capability).
 * 보는 사람의 claude.ai 계정마다 비공개 영역(`data/users/<id>/`)이 있어서,
 * 같은 계정으로 로그인한 어느 브라우저·기기에서 열어도 같은 계정과 데이터를 쓴다.
 */

interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}
interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
export interface QuerySnap {
  docs: DocSnap[];
  docChanges(): { type: 'added' | 'modified' | 'removed'; doc: DocSnap }[];
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}
interface CollRef {
  doc(id: string): DocRef;
  onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code: string; message: string }) => void): () => void;
}
interface DB {
  doc(path: string): DocRef;
  collection(path: string): CollRef;
}
interface UserNs {
  id(): Promise<string | null>;
  can(capability: string): Promise<boolean | null>;
}
interface ClaudeGlobal {
  use(name: string): Promise<unknown>;
}

export interface ArtifactStore {
  uid: string;
  account: DocRef;
  items: CollRef;
}

let store: ArtifactStore | null = null;
let ready: Promise<ArtifactStore | null> | null = null;

export const artifactBuild = import.meta.env.MODE === 'artifact';

/** 페이지 시작 때 한 번: 쓸 수 있으면 저장소, 아니면 null (로그아웃 상태, 페이지 단독 열기 등) */
export function initArtifactStore(): Promise<ArtifactStore | null> {
  if (ready) return ready;
  ready = (async () => {
    const claude = (window as unknown as { claude?: ClaudeGlobal }).claude;
    if (!artifactBuild || !claude?.use) return null;
    const [db, user] = (await Promise.all([claude.use('db'), claude.use('user')])) as [DB | null, UserNs | null];
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    // 읽기만 허용된 보기(조직 밖에서 공유 링크로 연 경우 등)는 이 브라우저에만 저장한다
    if ((await user.can('data.write').catch(() => null)) === false) return null;
    const base = `data/users/${uid}`;
    store = { uid, account: db.doc(`${base}/account`), items: db.collection(`${base}/sync/items`) };
    return store;
  })().catch((e) => {
    console.warn('artifact store unavailable', e);
    return null;
  });
  return ready;
}

export const getArtifactStore = () => store;

/** 저장소 쓰기가 거절되면(권한 없음) 이번 방문은 이 브라우저에만 저장한다 */
export function disableArtifactStore() {
  store = null;
}
