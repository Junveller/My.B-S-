-- Bisje 서버 (Supabase SQL Editor에 이 파일 전체를 붙여넣고 Run)
-- 닉네임 + 숫자 4자리 로그인, 5회 실패 잠금, 복구 코드, 항목 단위 동기화를 모두 이 함수들이 처리한다.
-- 테이블은 RLS만 켜고 정책을 두지 않아 앱(anon 키)에서 직접 읽거나 쓸 수 없다.
-- 다시 실행해도 안전하다 (기존 데이터는 유지).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.bisje_accounts (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  nickname_key text not null unique,
  pin_hash text not null,
  recovery_hash text not null,
  failed_count int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bisje_sessions (
  token_hash text primary key,
  account_id uuid not null references public.bisje_accounts on delete cascade,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);

create table if not exists public.bisje_records (
  account_id uuid not null references public.bisje_accounts on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (account_id, tbl, id)
);
create index if not exists bisje_records_pull on public.bisje_records (account_id, server_updated_at);

alter table public.bisje_accounts enable row level security;
alter table public.bisje_sessions enable row level security;
alter table public.bisje_records enable row level security;
revoke all on public.bisje_accounts, public.bisje_sessions, public.bisje_records from anon, authenticated;

-- ---------- 내부 도우미 ----------

-- 한글은 NFC로 맞추고(맥/아이폰 입력 차이), 공백을 정리하고, 대소문자를 무시한다
create or replace function public.bisje_clean_nick(p text) returns text
language sql immutable as $$
  select regexp_replace(btrim(normalize(coalesce(p, ''), nfc)), '\s+', ' ', 'g')
$$;
create or replace function public.bisje_nick_key(p text) returns text
language sql immutable as $$ select lower(public.bisje_clean_nick(p)) $$;
create or replace function public.bisje_norm_code(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')) $$;

-- 헷갈리는 글자(0/O, 1/I/L) 없는 복구 코드 XXXX-XXXX-XXXX
create or replace function public.bisje_make_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  a text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := gen_random_bytes(12);
  s text := '';
begin
  for i in 0..11 loop
    s := s || substr(a, (get_byte(b, i) % length(a)) + 1, 1);
  end loop;
  return substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4);
end $$;

create or replace function public.bisje_hash(p text) returns text
language sql volatile set search_path = public, extensions as $$ select crypt(p, gen_salt('bf', 8)) $$;

-- 로그인 토큰: 앱에는 원문, 서버에는 SHA-256만 저장
create or replace function public.bisje_new_session(p_account uuid) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into bisje_sessions (token_hash, account_id) values (encode(digest(t, 'sha256'), 'hex'), p_account);
  return t;
end $$;

create or replace function public.bisje_account_for(p_token text) returns uuid
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v uuid;
begin
  update bisje_sessions set last_used = now()
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
  returning account_id into v;
  if v is null then
    raise exception 'session' using hint = 'bisje';
  end if;
  return v;
end $$;

-- 잠금 확인 → 검증 → 실패 횟수 기록 (실패도 저장돼야 하므로 예외 대신 결과로 돌려준다)
create or replace function public.bisje_verify(p_nickname text, p_secret text, p_recovery boolean) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  a bisje_accounts;
  ok boolean;
  v_failed int;
  v_until timestamptz;
begin
  select * into a from bisje_accounts where nickname_key = bisje_nick_key(p_nickname) for update;
  if not found then
    perform crypt('0000', gen_salt('bf', 8)); -- 응답 시간을 비슷하게
    return jsonb_build_object('error', 'no_account');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'lockedUntil', floor(extract(epoch from a.locked_until) * 1000));
  end if;
  if p_recovery then
    ok := a.recovery_hash = crypt(bisje_norm_code(p_secret), a.recovery_hash);
  else
    ok := a.pin_hash = crypt(coalesce(p_secret, ''), a.pin_hash);
  end if;
  if ok then
    update bisje_accounts set failed_count = 0, lock_count = 0, locked_until = null where id = a.id;
    return jsonb_build_object('ok', true, 'userId', a.id, 'nickname', a.nickname);
  end if;
  v_failed := a.failed_count + 1;
  if v_failed >= 5 then
    -- 10분부터 시작해 잠길 때마다 두 배, 최대 24시간
    v_until := now() + least(interval '10 minutes' * power(2, a.lock_count), interval '24 hours');
    update bisje_accounts set failed_count = 0, lock_count = a.lock_count + 1, locked_until = v_until where id = a.id;
    return jsonb_build_object('error', 'locked', 'lockedUntil', floor(extract(epoch from v_until) * 1000));
  end if;
  update bisje_accounts set failed_count = v_failed where id = a.id;
  return jsonb_build_object('error', 'invalid', 'remaining', 5 - v_failed);
end $$;

-- ---------- 앱에서 부르는 함수 ----------

create or replace function public.bisje_signup(p_nickname text, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_nick text := bisje_clean_nick(p_nickname);
  v_id uuid;
  v_code text := bisje_make_code();
begin
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then
    return jsonb_build_object('error', 'nickname', 'message', '닉네임은 1~20자로 입력해 주세요');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'pin');
  end if;
  begin
    insert into bisje_accounts (nickname, nickname_key, pin_hash, recovery_hash)
    values (v_nick, bisje_nick_key(v_nick), bisje_hash(p_pin), bisje_hash(bisje_norm_code(v_code)))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'taken');
  end;
  return jsonb_build_object('token', bisje_new_session(v_id), 'userId', v_id, 'nickname', v_nick, 'recoveryCode', v_code);
end $$;

create or replace function public.bisje_login(p_nickname text, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'pin');
  end if;
  r := bisje_verify(p_nickname, p_pin, false);
  if r ? 'error' then return r; end if;
  return r || jsonb_build_object('token', bisje_new_session((r->>'userId')::uuid));
end $$;

-- 복구 코드로 비밀번호 재설정 → 새 복구 코드, 다른 기기의 로그인은 끊는다
create or replace function public.bisje_reset(p_nickname text, p_code text, p_new_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r jsonb;
  v_id uuid;
  v_code text := bisje_make_code();
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'pin');
  end if;
  r := bisje_verify(p_nickname, p_code, true);
  if r ? 'error' then return r; end if;
  v_id := (r->>'userId')::uuid;
  update bisje_accounts set pin_hash = bisje_hash(p_new_pin), recovery_hash = bisje_hash(bisje_norm_code(v_code)) where id = v_id;
  delete from bisje_sessions where account_id = v_id;
  return r || jsonb_build_object('token', bisje_new_session(v_id), 'recoveryCode', v_code);
end $$;

create or replace function public.bisje_set_pin(p_token text, p_new_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid := bisje_account_for(p_token);
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('error', 'pin');
  end if;
  update bisje_accounts set pin_hash = bisje_hash(p_new_pin), failed_count = 0, locked_until = null where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bisje_regen_recovery(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_id uuid := bisje_account_for(p_token);
  v_code text := bisje_make_code();
begin
  update bisje_accounts set recovery_hash = bisje_hash(bisje_norm_code(v_code)) where id = v_id;
  return jsonb_build_object('recoveryCode', v_code);
end $$;

create or replace function public.bisje_logout(p_token text) returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from bisje_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- 일괄 업로드: 서버에 있는 것보다 새로운 항목만 덮어쓴다 (항목 단위 최종 수정 우선)
create or replace function public.bisje_push(p_token text, p_items jsonb) returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid := bisje_account_for(p_token);
begin
  insert into bisje_records (account_id, tbl, id, data, updated_at, deleted, server_updated_at)
  select v_id, x->>'tbl', x->>'id', x->'data', (x->>'updated_at')::bigint, coalesce((x->>'deleted')::boolean, false), clock_timestamp()
    from jsonb_array_elements(p_items) as x
  on conflict (account_id, tbl, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, server_updated_at = clock_timestamp()
    where bisje_records.updated_at < excluded.updated_at;
end $$;

-- 커서 이후에 바뀐 항목 (최대 1000개씩)
create or replace function public.bisje_pull(p_token text, p_since timestamptz)
returns table (tbl text, id text, data jsonb, updated_at bigint, server_updated_at timestamptz)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid := bisje_account_for(p_token);
begin
  return query
    select r.tbl, r.id, r.data, r.updated_at, r.server_updated_at
      from bisje_records r
     where r.account_id = v_id and r.server_updated_at > p_since
     order by r.server_updated_at
     limit 1000;
end $$;

-- 앱(anon 키)이 부를 수 있는 것은 아래 함수뿐
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.bisje_signup(text, text),
  public.bisje_login(text, text),
  public.bisje_reset(text, text, text),
  public.bisje_set_pin(text, text),
  public.bisje_regen_recovery(text),
  public.bisje_logout(text),
  public.bisje_push(text, jsonb),
  public.bisje_pull(text, timestamptz)
to anon, authenticated;
