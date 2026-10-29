import { delMeta, getMeta, setMeta } from './db';
import { clearLocalData } from './data';
import { isPin, kdf, makeRecoveryCode, normalizeCode, randomHex } from './crypto';
import { AuthError, callAuth, remoteMode, supabase } from './supabase';
import { flushSync, resetSyncState } from './sync';

export interface SessionInfo {
  nickname: string;
  userId: string;
  /** 가입 직후 보여준 복구 코드 (설정 > 복구 코드 확인용, 이 기기에만 보관) */
  recoveryCode?: string;
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

const MAX_TRIES = 5;
const lockMs = (lockCount: number) => Math.min(10 * 60_000 * 2 ** lockCount, 24 * 3600_000);

export async function currentSession(): Promise<SessionInfo | undefined> {
  const s = await getMeta<SessionInfo>('session');
  if (!s) return undefined;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return undefined;
  }
  return s;
}

export function validateNickname(n: string) {
  const t = n.trim();
  if (t.length < 1 || t.length > 20) return '닉네임은 1~20자로 입력해 주세요';
  return null;
}

type RemoteSession = { access_token: string; refresh_token: string };

async function adoptRemote(session: RemoteSession, nickname: string, userId: string, recoveryCode?: string) {
  await supabase!.auth.setSession(session);
  const info: SessionInfo = { nickname, userId, recoveryCode };
  await setMeta('session', info);
  return info;
}

export async function signUp(nickname: string, pin: string): Promise<SessionInfo> {
  nickname = nickname.trim();
  const bad = validateNickname(nickname);
  if (bad) throw new AuthError('nickname', { message: bad });
  if (!isPin(pin)) throw new AuthError('pin');
  if (remoteMode) {
    const r = await callAuth<{ session: RemoteSession; userId: string; recoveryCode: string }>('signup', { nickname, pin });
    return adoptRemote(r.session, nickname, r.userId, r.recoveryCode);
  }
  const existing = await getMeta<LocalAccount>('account');
  if (existing && existing.nickname.toLowerCase() === nickname.toLowerCase()) throw new AuthError('taken');
  if (existing) await clearLocalData();
  const salt = randomHex();
  const code = makeRecoveryCode();
  const acc: LocalAccount = {
    nickname, salt, pinHash: await kdf(pin, salt), recoveryHash: await kdf(normalizeCode(code), salt),
    failed: 0, lockCount: 0, lockUntil: 0,
  };
  await setMeta('account', acc);
  const info: SessionInfo = { nickname, userId: 'local', recoveryCode: code };
  await setMeta('session', info);
  return info;
}

/** 로컬 모드 잠금 처리 (서버 모드는 서버에서 강제) */
async function localVerify(nickname: string, check: (acc: LocalAccount) => Promise<boolean>) {
  const acc = await getMeta<LocalAccount>('account');
  if (!acc || acc.nickname.toLowerCase() !== nickname.trim().toLowerCase()) throw new AuthError('invalid', { remaining: MAX_TRIES });
  if (acc.lockUntil > Date.now()) throw new AuthError('locked', { lockedUntil: acc.lockUntil });
  if (await check(acc)) {
    await setMeta('account', { ...acc, failed: 0, lockCount: 0, lockUntil: 0 });
    return acc;
  }
  const failed = acc.failed + 1;
  if (failed >= MAX_TRIES) {
    const lockUntil = Date.now() + lockMs(acc.lockCount);
    await setMeta('account', { ...acc, failed: 0, lockCount: acc.lockCount + 1, lockUntil });
    throw new AuthError('locked', { lockedUntil: lockUntil });
  }
  await setMeta('account', { ...acc, failed });
  throw new AuthError('invalid', { remaining: MAX_TRIES - failed });
}

export async function signIn(nickname: string, pin: string): Promise<SessionInfo> {
  nickname = nickname.trim();
  if (remoteMode) {
    const r = await callAuth<{ session: RemoteSession; userId: string; nickname: string }>('login', { nickname, pin });
    return adoptRemote(r.session, r.nickname, r.userId);
  }
  const acc = await localVerify(nickname, async (a) => (await kdf(pin, a.salt)) === a.pinHash);
  const info: SessionInfo = { nickname: acc.nickname, userId: 'local' };
  await setMeta('session', info);
  return info;
}

/** 복구 코드로 PIN 재설정 → 새 복구 코드 발급 */
export async function resetWithCode(nickname: string, code: string, newPin: string): Promise<SessionInfo> {
  if (!isPin(newPin)) throw new AuthError('pin');
  nickname = nickname.trim();
  if (remoteMode) {
    const r = await callAuth<{ session: RemoteSession; userId: string; nickname: string; recoveryCode: string }>(
      'reset_with_code', { nickname, code: normalizeCode(code), newPin },
    );
    return adoptRemote(r.session, r.nickname, r.userId, r.recoveryCode);
  }
  const acc = await localVerify(nickname, async (a) => (await kdf(normalizeCode(code), a.salt)) === a.recoveryHash);
  const salt = randomHex();
  const next = makeRecoveryCode();
  await setMeta('account', {
    ...acc, salt, pinHash: await kdf(newPin, salt), recoveryHash: await kdf(normalizeCode(next), salt),
  });
  const info: SessionInfo = { nickname: acc.nickname, userId: 'local', recoveryCode: next };
  await setMeta('session', info);
  return info;
}

async function accessToken() {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new AuthError('session');
  return data.session.access_token;
}

/** 로그인된 상태에서 PIN 변경 (이메일 재설정 링크로 들어온 경우 포함) */
export async function setPin(newPin: string) {
  if (!isPin(newPin)) throw new AuthError('pin');
  if (remoteMode) {
    await callAuth('set_pin', { newPin }, await accessToken());
    return;
  }
  const acc = await getMeta<LocalAccount>('account');
  if (!acc) throw new AuthError('session');
  await setMeta('account', { ...acc, pinHash: await kdf(newPin, acc.salt), failed: 0, lockUntil: 0 });
}

export async function regenerateRecoveryCode(): Promise<string> {
  let code: string;
  if (remoteMode) {
    code = (await callAuth<{ recoveryCode: string }>('regen_recovery', {}, await accessToken())).recoveryCode;
  } else {
    const acc = await getMeta<LocalAccount>('account');
    if (!acc) throw new AuthError('session');
    code = makeRecoveryCode();
    await setMeta('account', { ...acc, recoveryHash: await kdf(normalizeCode(code), acc.salt) });
  }
  const s = await getMeta<SessionInfo>('session');
  if (s) await setMeta('session', { ...s, recoveryCode: code });
  return code;
}

export async function linkEmail(email: string) {
  if (!supabase) throw new AuthError('local');
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: location.origin });
  if (error) throw new AuthError('email', { message: error.message });
}

export async function linkedEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const e = data.user?.email ?? '';
  return e.endsWith('@users.bisje.example.com') ? null : e || null;
}

export async function requestEmailReset(email: string) {
  if (!supabase) throw new AuthError('local');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw new AuthError('email', { message: error.message });
}

/** 이메일 재설정 링크로 들어온 경우: 세션 정보를 서버에서 다시 받아 둔다 */
export async function adoptRecoverySession(): Promise<SessionInfo | undefined> {
  if (!supabase) return undefined;
  const r = await callAuth<{ userId: string; nickname: string }>('whoami', {}, await accessToken());
  const info: SessionInfo = { nickname: r.nickname, userId: r.userId };
  await setMeta('session', info);
  return info;
}

export async function signOut() {
  if (remoteMode) {
    await flushSync().catch(() => undefined);
    await supabase!.auth.signOut().catch(() => undefined);
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
    case 'email': return String(e.data.message ?? '이메일을 확인해 주세요');
    case 'local': return '서버에 연결된 경우에만 사용할 수 있어요';
    default: return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
  }
}
