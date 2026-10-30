import { delMeta, getMeta, setMeta } from './db';
import { clearLocalData } from './data';
import { isPin, kdf, makeRecoveryCode, normalizeCode, randomHex } from './crypto';
import { AuthError, remoteMode, rpc } from './supabase';
import { flushSync, resetSyncState } from './sync';
import { artifactBuild, disableArtifactStore, getArtifactStore } from './artifactStore';

export interface SessionInfo {
  nickname: string;
  userId: string;
  /** 가입 직후 보여준 복구 코드 (설정 > 복구 코드 확인용, 이 기기에만 보관) */
  recoveryCode?: string;
  /** 서버 로그인 토큰 (서버 모드) */
  token?: string;
}

interface LocalAccount {
  nickname: string;
  salt: string;
  pinHash: string;
  recoveryHash: string;
  failed: number;
  lockCount: number;
  lockUntil: number;
}

/** 계정과 데이터를 어디에 두는지: 서버(Supabase) / claude.ai 계정(페이지 저장소) / 이 브라우저 */
export type StorageMode = 'server' | 'claude' | 'local';
export const storageMode = (): StorageMode => (remoteMode ? 'server' : getArtifactStore() ? 'claude' : 'local');
/** 서버나 claude.ai 계정처럼 이 브라우저 밖에 저장되는 경우 */
export const syncedMode = () => storageMode() !== 'local';

/**
 * 로컬 계정 읽기/쓰기. claude.ai 페이지에서는 보는 사람의 claude.ai 계정 비공개 영역에 두어
 * 다른 브라우저·기기에서도 같은 닉네임과 비밀번호로 로그인된다.
 */
async function loadAccount(): Promise<LocalAccount | undefined> {
  const st = getArtifactStore();
  const local = await getMeta<LocalAccount>('account');
  if (!st) return local;
  const snap = await st.account.get();
  if (snap.exists) {
    const acc = snap.data() as unknown as LocalAccount;
    await setMeta('account', acc);
    return acc;
  }
  // 이전 버전(이 브라우저에만 저장)에서 만든 계정이면 claude.ai 계정으로 올려 둔다
  if (local) await saveAccount(local);
  return local;
}

async function saveAccount(acc: LocalAccount) {
  await setMeta('account', acc);
  const st = getArtifactStore();
  if (!st) return;
  try {
    await st.account.set({ ...acc });
  } catch (e) {
    if ((e as { code?: string })?.code !== 'invalid_argument') throw e;
    disableArtifactStore(); // 이 보기에는 쓰기 권한이 없다
  }
}

/** claude.ai 페이지: 이 브라우저에 있던 계정을 claude.ai 계정으로 옮긴다 (시작할 때 한 번) */
export async function linkAccountToStore() {
  if (getArtifactStore()) await loadAccount().catch(() => undefined);
}

const localUserId = () => getArtifactStore()?.uid ?? 'local';

const MAX_TRIES = 5;
const lockMs = (lockCount: number) => Math.min(10 * 60_000 * 2 ** lockCount, 24 * 3600_000);

export async function currentSession(): Promise<SessionInfo | undefined> {
  const s = await getMeta<SessionInfo>('session');
  if (!s) return undefined;
  const st = getArtifactStore();
  if (st && s.userId !== st.uid) {
    if (s.userId !== 'local') {
      // 이 브라우저에 다른 claude.ai 계정의 데이터가 남아 있으면 지우고 다시 로그인
      await clearLocalData();
      return undefined;
    }
    const adopted = { ...s, userId: st.uid };
    await setMeta('session', adopted);
    return adopted;
  }
  if (remoteMode && !s.token) return undefined;
  return s;
}

/** 한글·영문·숫자 모두 허용. 맥(NFD)과 아이폰(NFC)에서 입력한 한글이 같은 닉네임이 되도록 NFC로 맞춘다 */
export const normalizeNickname = (n: string) => n.normalize('NFC').trim().replace(/\s+/g, ' ');
const nicknameKey = (n: string) => normalizeNickname(n).toLowerCase();

export function validateNickname(n: string) {
  const t = normalizeNickname(n);
  if (t.length < 1 || t.length > 20) return '닉네임은 1~20자로 입력해 주세요';
  // 보이지 않는 제어 문자만 막는다 (한글, 영문, 숫자, 기호는 모두 가능)
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/.test(t)) return '닉네임에 쓸 수 없는 문자가 있어요';
  return null;
}

interface RemoteLogin {
  token: string;
  userId: string;
  nickname: string;
  recoveryCode?: string;
}

async function adoptRemote(r: RemoteLogin) {
  const info: SessionInfo = { nickname: r.nickname, userId: r.userId, token: r.token, recoveryCode: r.recoveryCode };
  await setMeta('session', info);
  return info;
}

async function token() {
  const t = (await getMeta<SessionInfo>('session'))?.token;
  if (!t) throw new AuthError('session');
  return t;
}

export async function signUp(nickname: string, pin: string): Promise<SessionInfo> {
  nickname = normalizeNickname(nickname);
  const bad = validateNickname(nickname);
  if (bad) throw new AuthError('nickname', { message: bad });
  if (!isPin(pin)) throw new AuthError('pin');
  if (remoteMode) {
    return adoptRemote(await rpc<RemoteLogin>('bisje_signup', { p_nickname: nickname, p_pin: pin }));
  }
  const existing = await loadAccount();
  if (existing && getArtifactStore()) throw new AuthError('exists', { nickname: existing.nickname });
  if (existing && nicknameKey(existing.nickname) === nicknameKey(nickname)) throw new AuthError('taken');
  if (existing) await clearLocalData();
  const salt = randomHex();
  const code = makeRecoveryCode();
  const acc: LocalAccount = {
    nickname, salt, pinHash: await kdf(pin, salt), recoveryHash: await kdf(normalizeCode(code), salt),
    failed: 0, lockCount: 0, lockUntil: 0,
  };
  await saveAccount(acc);
  const info: SessionInfo = { nickname, userId: localUserId(), recoveryCode: code };
  await setMeta('session', info);
  return info;
}

/** 로컬 모드 잠금 처리 (서버 모드는 서버에서 강제) */
async function localVerify(nickname: string, check: (acc: LocalAccount) => Promise<boolean>) {
  const acc = await loadAccount();
  // 가입 기록이 없는 경우는 비밀번호가 틀린 것과 구분해서 알려 준다
  if (!acc) throw new AuthError('no_account');
  if (nicknameKey(acc.nickname) !== nicknameKey(nickname)) throw new AuthError('other_nickname', { nickname: acc.nickname });
  if (acc.lockUntil > Date.now()) throw new AuthError('locked', { lockedUntil: acc.lockUntil });
  if (await check(acc)) {
    await saveAccount({ ...acc, failed: 0, lockCount: 0, lockUntil: 0 });
    return acc;
  }
  const failed = acc.failed + 1;
  if (failed >= MAX_TRIES) {
    const lockUntil = Date.now() + lockMs(acc.lockCount);
    await saveAccount({ ...acc, failed: 0, lockCount: acc.lockCount + 1, lockUntil });
    throw new AuthError('locked', { lockedUntil: lockUntil });
  }
  await saveAccount({ ...acc, failed });
  throw new AuthError('invalid', { remaining: MAX_TRIES - failed });
}

export async function signIn(nickname: string, pin: string): Promise<SessionInfo> {
  nickname = normalizeNickname(nickname);
  if (remoteMode) {
    return adoptRemote(await rpc<RemoteLogin>('bisje_login', { p_nickname: nickname, p_pin: pin }));
  }
  const acc = await localVerify(nickname, async (a) => (await kdf(pin, a.salt)) === a.pinHash);
  const info: SessionInfo = { nickname: acc.nickname, userId: localUserId() };
  await setMeta('session', info);
  return info;
}

/** 복구 코드로 PIN 재설정 → 새 복구 코드 발급 */
export async function resetWithCode(nickname: string, code: string, newPin: string): Promise<SessionInfo> {
  if (!isPin(newPin)) throw new AuthError('pin');
  nickname = normalizeNickname(nickname);
  if (remoteMode) {
    return adoptRemote(await rpc<RemoteLogin>('bisje_reset', { p_nickname: nickname, p_code: normalizeCode(code), p_new_pin: newPin }));
  }
  const acc = await localVerify(nickname, async (a) => (await kdf(normalizeCode(code), a.salt)) === a.recoveryHash);
  const salt = randomHex();
  const next = makeRecoveryCode();
  await saveAccount({
    ...acc, salt, pinHash: await kdf(newPin, salt), recoveryHash: await kdf(normalizeCode(next), salt),
  });
  const info: SessionInfo = { nickname: acc.nickname, userId: localUserId(), recoveryCode: next };
  await setMeta('session', info);
  return info;
}

/** 로그인된 상태에서 비밀번호 변경 */
export async function setPin(newPin: string) {
  if (!isPin(newPin)) throw new AuthError('pin');
  if (remoteMode) {
    await rpc('bisje_set_pin', { p_token: await token(), p_new_pin: newPin });
    return;
  }
  const acc = await loadAccount();
  if (!acc) throw new AuthError('session');
  await saveAccount({ ...acc, pinHash: await kdf(newPin, acc.salt), failed: 0, lockUntil: 0 });
}

export async function regenerateRecoveryCode(): Promise<string> {
  let code: string;
  if (remoteMode) {
    code = (await rpc<{ recoveryCode: string }>('bisje_regen_recovery', { p_token: await token() })).recoveryCode;
  } else {
    const acc = await loadAccount();
    if (!acc) throw new AuthError('session');
    code = makeRecoveryCode();
    await saveAccount({ ...acc, recoveryHash: await kdf(normalizeCode(code), acc.salt) });
  }
  const s = await getMeta<SessionInfo>('session');
  if (s) await setMeta('session', { ...s, recoveryCode: code });
  return code;
}

export async function signOut() {
  if (remoteMode) {
    await flushSync().catch(() => undefined);
    await rpc('bisje_logout', { p_token: await token() }).catch(() => undefined);
    await clearLocalData();
  } else if (getArtifactStore()) {
    // claude.ai 계정에 저장돼 있으므로 이 브라우저의 사본은 지운다 (다시 로그인하면 불러옴)
    await flushSync().catch(() => undefined);
    await clearLocalData();
  } else {
    // 로컬 모드: 데이터는 이 기기에만 있으므로 지우지 않고 세션만 끝낸다
    await delMeta('session');
  }
  resetSyncState();
}

export function authErrorMessage(e: unknown): string {
  if (!(e instanceof AuthError)) return '연결에 실패했어요. 잠시 후 다시 시도해 주세요.';
  switch (e.code) {
    case 'taken': return '이미 사용 중인 닉네임이에요';
    case 'nickname': return String(e.data.message ?? '닉네임을 확인해 주세요');
    case 'pin': return '비밀번호는 숫자 4자리예요';
    case 'invalid': {
      const r = Number(e.data.remaining);
      return Number.isFinite(r) && r > 0 ? `닉네임 또는 비밀번호가 맞지 않아요 (남은 횟수 ${r}번)` : '닉네임 또는 비밀번호가 맞지 않아요';
    }
    case 'locked': {
      const until = Number(e.data.lockedUntil);
      const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return `5번 틀려서 잠겼어요. ${mins}분 후에 다시 시도해 주세요.`;
    }
    case 'no_account':
      if (storageMode() === 'claude') return '이 claude.ai 계정으로 가입한 기록이 없어요. ‘처음이에요’에서 가입해 주세요.';
      if (artifactBuild) return 'claude.ai에 로그인되어 있지 않아서 계정을 불러올 수 없어요. 화면 맨 위 오른쪽의 ‘로그인’을 눌러 Claude 앱과 같은 계정으로 로그인한 뒤 다시 열어 주세요.';
      return storageMode() === 'claude'
        ? ''
        : '이 브라우저에는 가입 기록이 없어요. 서버가 연결되지 않아 계정은 가입한 브라우저에만 있어요. 가입했던 브라우저에서 열거나, 여기서 새로 가입해 주세요.';
    case 'other_nickname':
      return storageMode() === 'claude'
        ? `이 claude.ai 계정의 닉네임은 ‘${String(e.data.nickname)}’이에요. 그 닉네임으로 로그인해 주세요.`
        : `이 브라우저에 가입된 닉네임은 ‘${String(e.data.nickname)}’이에요. 그 닉네임으로 로그인해 주세요.`;
    case 'exists':
      return `이 claude.ai 계정에는 이미 ‘${String(e.data.nickname)}’ 계정이 있어요. 로그인해 주세요.`;
    case 'session': return '로그인이 끝났어요. 다시 로그인해 주세요.';
    case 'local': return '서버에 연결된 경우에만 사용할 수 있어요';
    default: return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  }
}
