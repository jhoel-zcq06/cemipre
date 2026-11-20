-- Migración 0008: Etiquetas de eventos en calendario y sincronización con Google Calendar.
-- 100% aditiva e idempotente: segura para aplicar en bases de datos con datos existentes.

-- 1. Etiquetas, color y metadatos de Google Calendar en public.eventos
alter table public.eventos
  add column if not exists etiqueta text not null default 'General',
  add column if not exists color text not null default '',
  add column if not exists todo_el_dia boolean not null default false,
  add column if not exists origen text not null default 'cemipre',
  add column if not exists google_event_id text not null default '',
  add column if not exists google_calendar_id text not null default '',
  add column if not exists google_calendar_name text not null default '',
  add column if not exists google_etag text not null default '',
  add column if not exists google_updated_at timestamptz,
  add column if not exists google_html_link text not null default '',
  add column if not exists sync_owner_user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eventos_etiqueta_len_check'
  ) then
    alter table public.eventos
      add constraint eventos_etiqueta_len_check
      check (char_length(trim(etiqueta)) between 1 and 60);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'eventos_color_len_check'
  ) then
    alter table public.eventos
      add constraint eventos_color_len_check
      check (char_length(color) <= 24);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'eventos_origen_check'
  ) then
    alter table public.eventos
      add constraint eventos_origen_check
      check (origen in ('cemipre', 'google'));
  end if;
end $$;

create unique index if not exists idx_eventos_google_unique
  on public.eventos (google_calendar_id, google_event_id)
  where google_event_id <> '';

create index if not exists idx_eventos_etiqueta
  on public.eventos (etiqueta);

create index if not exists idx_eventos_google_calendar_id
  on public.eventos (google_calendar_id)
  where google_calendar_id <> '';

-- 2. Estado y configuración compartida de sincronización con Google Calendar
create table if not exists public.google_calendar_sync_state (
  id text primary key default 'global',
  calendars jsonb not null default '[]'::jsonb,
  sync_direction text not null default 'bidirectional'
    check (sync_direction in ('import_only', 'bidirectional')),
  target_calendar_id text not null default 'primary',
  target_calendar_name text not null default 'Principal',
  auto_sync_enabled boolean not null default true,
  sync_en_curso boolean not null default false,
  sync_lock_until timestamptz,
  ultima_sincronizacion timestamptz,
  ultimo_estado text not null default '',
  actualizado timestamptz not null default now()
);

insert into public.google_calendar_sync_state (id)
values ('global')
on conflict (id) do nothing;

alter table public.google_calendar_sync_state enable row level security;

drop policy if exists google_calendar_sync_state_select_autorizado on public.google_calendar_sync_state;
create policy google_calendar_sync_state_select_autorizado
on public.google_calendar_sync_state for select
using (public.es_trabajador_autorizado());

drop policy if exists google_calendar_sync_state_insert_autorizado on public.google_calendar_sync_state;
create policy google_calendar_sync_state_insert_autorizado
on public.google_calendar_sync_state for insert
with check (public.es_trabajador_autorizado());

drop policy if exists google_calendar_sync_state_update_autorizado on public.google_calendar_sync_state;
create policy google_calendar_sync_state_update_autorizado
on public.google_calendar_sync_state for update
using (public.es_trabajador_autorizado())
with check (public.es_trabajador_autorizado());

-- 3. Extender mi_estado_google_drive() para informar si el token ya incluye permiso de Google Calendar
create or replace function public.mi_estado_google_drive()
returns jsonb
language plpgsql
stable
security definer
set search_path = private, public
as $$
declare
  v_uid uuid := auth.uid();
  v_own record;
  v_inst record;
begin
  if v_uid is null or not public.es_trabajador_autorizado() then
    return jsonb_build_object(
      'conectado', false,
      'status', 'desconectado',
      'tiene_calendar_scope', false,
      'institucional', jsonb_build_object(
        'conectado', false,
        'status', 'sin_configurar',
        'tiene_calendar_scope', false
      )
    );
  end if;

  select google_email, scopes, is_institutional, status, last_error, updated_at,
         (refresh_token_enc <> '') as tiene_refresh_token
  into v_own
  from private.google_oauth_tokens
  where user_id = v_uid
  limit 1;

  select user_id, google_email, scopes, status, last_error, updated_at
  into v_inst
  from private.google_oauth_tokens
  where is_institutional = true
  limit 1;

  return jsonb_build_object(
    'conectado', coalesce(v_own.status = 'conectado', false),
    'google_email', coalesce(v_own.google_email, ''),
    'status', coalesce(v_own.status, 'desconectado'),
    'scopes', coalesce(v_own.scopes, ''),
    'es_institucional', coalesce(v_own.is_institutional, false),
    'tiene_refresh_token', coalesce(v_own.tiene_refresh_token, false),
    'tiene_calendar_scope', coalesce(v_own.status = 'conectado' and v_own.scopes ilike '%calendar%', false),
    'last_error', coalesce(v_own.last_error, ''),
    'updated_at', v_own.updated_at,
    'institucional', jsonb_build_object(
      'conectado', coalesce(v_inst.status = 'conectado', false),
      'google_email', coalesce(v_inst.google_email, ''),
      'status', coalesce(v_inst.status, 'sin_configurar'),
      'es_propia', coalesce(v_inst.user_id = v_uid, false),
      'tiene_calendar_scope', coalesce(v_inst.status = 'conectado' and v_inst.scopes ilike '%calendar%', false),
      'last_error', coalesce(v_inst.last_error, ''),
      'updated_at', v_inst.updated_at
    )
  );
end;
$$;
revoke all on function public.mi_estado_google_drive() from public, anon;
grant execute on function public.mi_estado_google_drive() to authenticated;

-- 4. Habilitar Realtime en eventos y google_calendar_sync_state (opcional, no falla si no existe la publicación)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'eventos'
    ) then
      execute 'alter publication supabase_realtime add table public.eventos';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'google_calendar_sync_state'
    ) then
      execute 'alter publication supabase_realtime add table public.google_calendar_sync_state';
    end if;
  end if;
exception when others then
  raise notice 'No se pudo agregar tablas de calendario a supabase_realtime (%).', sqlerrm;
end $$;
