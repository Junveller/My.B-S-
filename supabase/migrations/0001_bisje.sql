-- Bisje 서버 스키마
-- accounts: 닉네임/PIN/복구코드/잠금 상태. RLS 정책이 없으므로 클라이언트는 접근 불가 (Edge Function의 service role만 사용)
create table if not exists public.accounts (
  user_id uuid primary key references auth.users on delete cascade,
  nickname text not null,
  nickname_key text not null unique,
  pin_salt text not null,
  pin_hash text not null,
  recovery_hash text not null,
  -- 실제 Supabase Auth 비밀번호 (무작위, 클라이언트에 절대 노출 안 됨)
  secret text not null,
  failed_count int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.accounts enable row level security;

-- records: 모든 동기화 데이터 (항목 단위, 최종 수정 시각 우선)
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, tbl, id)
);
create index if not exists records_pull_idx on public.records (user_id, server_updated_at);
alter table public.records enable row level security;

drop policy if exists records_select on public.records;
create policy records_select on public.records for select using (user_id = auth.uid());
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert with check (user_id = auth.uid());
drop policy if exists records_update on public.records;
create policy records_update on public.records for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 일괄 업로드: 서버에 있는 것보다 새로운 항목만 덮어쓴다
create or replace function public.push_records(items jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.records (user_id, tbl, id, data, updated_at, deleted, server_updated_at)
  select auth.uid(), x->>'tbl', x->>'id', x->'data', (x->>'updated_at')::bigint,
         coalesce((x->>'deleted')::boolean, false), clock_timestamp()
  from jsonb_array_elements(items) as x
  on conflict (user_id, tbl, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        server_updated_at = clock_timestamp()
    where public.records.updated_at < excluded.updated_at;
$$;

revoke all on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;
