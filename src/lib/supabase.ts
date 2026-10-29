import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 서버가 설정되지 않으면 null → 로컬 모드 */
export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export const remoteMode = !!supabase;

/** Edge Function 호출 (가입/로그인/잠금은 서버에서 처리) */
export async function callAuth<T>(action: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
  if (!url || !key) throw new Error('서버가 설정되지 않았어요');
  const res = await fetch(`${url}/functions/v1/bisje-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${accessToken ?? key}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(data.error ?? 'server', data);
  return data as T;
}

export class AuthError extends Error {
  constructor(public code: string, public data: Record<string, unknown> = {}) {
    super(code);
  }
}
