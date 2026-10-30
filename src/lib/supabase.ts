import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * 서버가 설정되지 않으면 null → 로컬 모드.
 * 로그인은 Supabase Auth가 아니라 supabase/bisje.sql의 함수들이 처리하므로 Auth 세션은 쓰지 않는다.
 */
export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

export const remoteMode = !!supabase;

export class AuthError extends Error {
  constructor(public code: string, public data: Record<string, unknown> = {}) {
    super(code);
  }
}

/** 서버 함수 호출. 함수가 돌려준 {error}와 로그인 만료는 AuthError로 바꾼다 */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new AuthError('local');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.message === 'session') throw new AuthError('session');
    throw new AuthError('server', { message: error.message });
  }
  const body = data as { error?: string } | null;
  if (body && typeof body === 'object' && !Array.isArray(body) && body.error) {
    throw new AuthError(body.error, body as Record<string, unknown>);
  }
  return data as T;
}
