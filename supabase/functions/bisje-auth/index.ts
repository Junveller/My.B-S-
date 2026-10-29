// Bisje 인증 Edge Function (Deno)
// 닉네임 + 4자리 PIN을 서버에서 검증하고, 5회 실패 시 잠금을 서버 측에서 강제한다.
// 실제 Supabase Auth 비밀번호는 무작위 secret이라 PIN만으로 Auth API를 직접 두드릴 수 없다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const MAX_TRIES = 5;
const INTERNAL_DOMAIN = 'users.bisje.example.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function kdf(secret: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 210_000 }, key, 256);
  return hex(bits);
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function recoveryCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const s = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b % alphabet.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const normCode = (s: string) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const isPin = (s: unknown) => typeof s === 'string' && /^\d{4}$/.test(s);
const normNick = (s: string) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const nickKey = (s: string) => normNick(s).toLowerCase();
const lockMs = (n: number) => Math.min(10 * 60_000 * 2 ** n, 24 * 3600_000);

interface Account {
  user_id: string; nickname: string; pin_salt: string; pin_hash: string; recovery_hash: string; secret: string;
  failed_count: number; lock_count: number; locked_until: string | null;
}

async function sessionFor(acc: Account) {
  const { data: u, error: ue } = await admin.auth.admin.getUserById(acc.user_id);
  if (ue || !u.user?.email) throw new Error('user');
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: u.user.email, password: acc.secret });
  if (error || !data.session) throw new Error('signin');
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

/** 잠금 확인 → 검증 → 실패 횟수 갱신 */
async function verify(nickname: string, check: (a: Account) => Promise<boolean>): Promise<Account | Response> {
  const { data: acc } = await admin.from('accounts').select('*').eq('nickname_key', nickKey(nickname)).maybeSingle<Account>();
  if (!acc) {
    await kdf('dummy', 'dummy'); // 존재 여부 타이밍 차이 줄이기
    return json(401, { error: 'invalid', remaining: MAX_TRIES });
  }
  if (acc.locked_until && new Date(acc.locked_until).getTime() > Date.now()) {
    return json(423, { error: 'locked', lockedUntil: new Date(acc.locked_until).getTime() });
  }
  if (await check(acc)) {
    await admin.from('accounts').update({ failed_count: 0, lock_count: 0, locked_until: null }).eq('user_id', acc.user_id);
    return acc;
  }
  const failed = acc.failed_count + 1;
  if (failed >= MAX_TRIES) {
    const until = Date.now() + lockMs(acc.lock_count);
    await admin.from('accounts').update({ failed_count: 0, lock_count: acc.lock_count + 1, locked_until: new Date(until).toISOString() })
      .eq('user_id', acc.user_id);
    return json(423, { error: 'locked', lockedUntil: until });
  }
  await admin.from('accounts').update({ failed_count: failed }).eq('user_id', acc.user_id);
  return json(401, { error: 'invalid', remaining: MAX_TRIES - failed });
}

async function authedAccount(req: Request): Promise<Account | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json(401, { error: 'session' });
  const { data: acc } = await admin.from('accounts').select('*').eq('user_id', data.user.id).maybeSingle<Account>();
  if (!acc) return json(404, { error: 'session' });
  return acc;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body' });
  }

  try {
    switch (body.action) {
      case 'signup': {
        const nickname = normNick(body.nickname);
        if (nickname.length < 1 || nickname.length > 20) return json(400, { error: 'nickname', message: '닉네임은 1~20자로 입력해 주세요' });
        if (!isPin(body.pin)) return json(400, { error: 'pin' });
        const { data: exists } = await admin.from('accounts').select('user_id').eq('nickname_key', nickKey(nickname)).maybeSingle();
        if (exists) return json(409, { error: 'taken' });

        const secret = randomHex(32);
        const { data: created, error } = await admin.auth.admin.createUser({
          email: `${crypto.randomUUID()}@${INTERNAL_DOMAIN}`, password: secret, email_confirm: true,
          user_metadata: { nickname },
        });
        if (error || !created.user) throw error ?? new Error('create');
        const salt = randomHex(16);
        const code = recoveryCode();
        const { error: ie } = await admin.from('accounts').insert({
          user_id: created.user.id, nickname, nickname_key: nickKey(nickname), pin_salt: salt,
          pin_hash: await kdf(body.pin, salt), recovery_hash: await kdf(normCode(code), salt), secret,
        });
        if (ie) {
          await admin.auth.admin.deleteUser(created.user.id);
          return json(409, { error: 'taken' }); // 동시 가입 경합
        }
        const acc = { user_id: created.user.id, secret } as Account;
        return json(200, { session: await sessionFor(acc), userId: created.user.id, recoveryCode: code });
      }

      case 'login': {
        if (!isPin(body.pin)) return json(400, { error: 'pin' });
        const r = await verify(String(body.nickname ?? ''), async (a) => safeEqual(await kdf(body.pin, a.pin_salt), a.pin_hash));
        if (r instanceof Response) return r;
        return json(200, { session: await sessionFor(r), userId: r.user_id, nickname: r.nickname });
      }

      case 'reset_with_code': {
        if (!isPin(body.newPin)) return json(400, { error: 'pin' });
        const r = await verify(String(body.nickname ?? ''), async (a) => safeEqual(await kdf(normCode(body.code), a.pin_salt), a.recovery_hash));
        if (r instanceof Response) return r;
        const salt = randomHex(16);
        const code = recoveryCode();
        await admin.from('accounts').update({
          pin_salt: salt, pin_hash: await kdf(body.newPin, salt), recovery_hash: await kdf(normCode(code), salt),
        }).eq('user_id', r.user_id);
        return json(200, { session: await sessionFor(r), userId: r.user_id, nickname: r.nickname, recoveryCode: code });
      }

      case 'set_pin': {
        if (!isPin(body.newPin)) return json(400, { error: 'pin' });
        const acc = await authedAccount(req);
        if (acc instanceof Response) return acc;
        // 복구 코드도 같은 salt로 해시돼 있으므로 salt는 유지
        await admin.from('accounts').update({ pin_hash: await kdf(body.newPin, acc.pin_salt), failed_count: 0, locked_until: null })
          .eq('user_id', acc.user_id);
        return json(200, { ok: true });
      }

      case 'regen_recovery': {
        const acc = await authedAccount(req);
        if (acc instanceof Response) return acc;
        const code = recoveryCode();
        await admin.from('accounts').update({ recovery_hash: await kdf(normCode(code), acc.pin_salt) }).eq('user_id', acc.user_id);
        return json(200, { recoveryCode: code });
      }

      case 'whoami': {
        const acc = await authedAccount(req);
        if (acc instanceof Response) return acc;
        return json(200, { userId: acc.user_id, nickname: acc.nickname });
      }

      default:
        return json(400, { error: 'action' });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: 'server' });
  }
});
