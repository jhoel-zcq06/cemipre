-- Migración 0007: Autenticación Google OAuth privada (tokens cifrados),
-- sincronización automática de Google Drive y trazabilidad de vinculación.
-- 100% aditiva e idempotente: segura para aplicar en bases de datos con datos existentes.

-- 1. Esquema privado y tabla de tokens OAuth cifrados (nunca expuesta a anon/authenticated)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.google_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text not null default '',
  google_sub text not null default '',
  scopes text not null default '',
  access_token_enc text not null default '',
  refresh_token_enc text not null default '',
  expires_at timestamptz,
  is_institutional boolean not null default false,
  status text not null default 'conectado'
    check (status in ('conectado', 'requiere_reconexion', 'desconectado')),
  last_error text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
revoke all on table private.google_oauth_tokens from public, anon, authenticated;
alter table private.google_oauth_tokens enable row level security;

-- Garantiza una única cuenta Google institucional activa para sincronización automática
create unique index if not exists idx_google_oauth_single_institutional
  on private.google_oauth_tokens (is_institutional)
  where is_institutional = true;

-- 2. Extensión aditiva de drive_sync_state para auto-sync, carpeta raíz y lock de concurrencia
alter table public.drive_sync_state
  add column if not exists root_folder_id text not null default '',
  add column if not exists root_folder_name text not null default '',
  add column if not exists auto_sync_enabled boolean not null default true,
  add column if not exists auto_sync_interval_min integer not null default 5,
  add column if not exists sync_en_curso boolean not null default false,
  add column if not exists sync_lock_until timestamptz,
  add column if not exists auth_mode text not null default 'ninguno',
  add column if not exists institutional_email text not null default '',
  add column if not exists connection_status text not null default 'sin_configurar';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'drive_sync_state_auth_mode_check'
  ) then
    alter table public.drive_sync_state
      add constraint drive_sync_state_auth_mode_check
      check (auth_mode in ('oauth_institucional', 'service_account', 'ninguno'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'drive_sync_state_connection_status_check'
  ) then
    alter table public.drive_sync_state
      add constraint drive_sync_state_connection_status_check
      check (connection_status in ('conectado', 'requiere_reconexion', 'sin_configurar'));
  end if;
end $$;

insert into public.drive_sync_state (id)
values ('global')
on conflict (id) do nothing;

-- 3. Metadatos de carpeta y propietario de vinculación privada en personas y bitácoras
alter table public.personas
  add column if not exists drive_folder_name text not null default '',
  add column if not exists linked_by_user_id uuid references auth.users(id) on delete set null;

alter table public.bitacoras
  add column if not exists linked_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_personas_linked_by_user_id
  on public.personas(linked_by_user_id);

create index if not exists idx_bitacoras_linked_by_user_id
  on public.bitacoras(linked_by_user_id);

-- 4. RPC segura para la UI: devuelve solo estado no sensible (jamás tokens)
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
      'institucional', jsonb_build_object('conectado', false, 'status', 'sin_configurar')
    );
  end if;

  select google_email, scopes, is_institutional, status, last_error, updated_at,
         (refresh_token_enc <> '') as tiene_refresh_token
  into v_own
  from private.google_oauth_tokens
  where user_id = v_uid
  limit 1;

  select user_id, google_email, status, last_error, updated_at
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
    'last_error', coalesce(v_own.last_error, ''),
    'updated_at', v_own.updated_at,
    'institucional', jsonb_build_object(
      'conectado', coalesce(v_inst.status = 'conectado', false),
      'google_email', coalesce(v_inst.google_email, ''),
      'status', coalesce(v_inst.status, 'sin_configurar'),
      'es_propia', coalesce(v_inst.user_id = v_uid, false),
      'last_error', coalesce(v_inst.last_error, ''),
      'updated_at', v_inst.updated_at
    )
  );
end;
$$;
revoke all on function public.mi_estado_google_drive() from public, anon;
grant execute on function public.mi_estado_google_drive() to authenticated;

-- 5. Funciones internas (solo service_role) para leer/escribir private.google_oauth_tokens
--    sin exponer el esquema private en PostgREST.

create or replace function public.srv_upsert_google_oauth_token(
  p_user_id uuid,
  p_google_email text,
  p_google_sub text,
  p_scopes text,
  p_access_token_enc text,
  p_refresh_token_enc text,
  p_expires_at timestamptz,
  p_set_institutional boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_now timestamptz := now();
  v_final_institutional boolean := false;
  v_has_refresh boolean := false;
begin
  if p_set_institutional then
    update private.google_oauth_tokens
    set is_institutional = false, updated_at = v_now
    where is_institutional = true and user_id <> p_user_id;
  end if;

  insert into private.google_oauth_tokens (
    user_id, google_email, google_sub, scopes,
    access_token_enc, refresh_token_enc, expires_at,
    is_institutional, status, last_error, updated_at, created_at
  )
  values (
    p_user_id,
    coalesce(trim(p_google_email), ''),
    coalesce(trim(p_google_sub), ''),
    coalesce(trim(p_scopes), ''),
    coalesce(p_access_token_enc, ''),
    coalesce(p_refresh_token_enc, ''),
    p_expires_at,
    coalesce(p_set_institutional, false),
    'conectado',
    '',
    v_now,
    v_now
  )
  on conflict (user_id) do update
    set google_email = case when excluded.google_email <> '' then excluded.google_email else private.google_oauth_tokens.google_email end,
        google_sub = case when excluded.google_sub <> '' then excluded.google_sub else private.google_oauth_tokens.google_sub end,
        scopes = case when excluded.scopes <> '' then excluded.scopes else private.google_oauth_tokens.scopes end,
        access_token_enc = case when excluded.access_token_enc <> '' then excluded.access_token_enc else private.google_oauth_tokens.access_token_enc end,
        refresh_token_enc = case when excluded.refresh_token_enc <> '' then excluded.refresh_token_enc else private.google_oauth_tokens.refresh_token_enc end,
        expires_at = coalesce(excluded.expires_at, private.google_oauth_tokens.expires_at),
        is_institutional = case when p_set_institutional then true else private.google_oauth_tokens.is_institutional end,
        status = 'conectado',
        last_error = '',
        updated_at = v_now
  returning is_institutional, (refresh_token_enc <> '')
  into v_final_institutional, v_has_refresh;

  if v_final_institutional then
    insert into public.drive_sync_state (id, auth_mode, institutional_email, connection_status, actualizado)
    values ('global', 'oauth_institucional', coalesce(trim(p_google_email), ''), 'conectado', v_now)
    on conflict (id) do update
      set auth_mode = 'oauth_institucional',
          institutional_email = case when excluded.institutional_email <> '' then excluded.institutional_email else public.drive_sync_state.institutional_email end,
          connection_status = 'conectado',
          actualizado = v_now;
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_institutional', v_final_institutional,
    'tiene_refresh_token', v_has_refresh
  );
end;
$$;
revoke all on function public.srv_upsert_google_oauth_token(uuid, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.srv_upsert_google_oauth_token(uuid, text, text, text, text, text, timestamptz, boolean) to service_role;

create or replace function public.srv_get_google_oauth_token(p_user_id uuid)
returns table (
  user_id uuid,
  google_email text,
  google_sub text,
  scopes text,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  is_institutional boolean,
  status text,
  last_error text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = private, public
as $$
  select
    t.user_id, t.google_email, t.google_sub, t.scopes,
    t.access_token_enc, t.refresh_token_enc, t.expires_at,
    t.is_institutional, t.status, t.last_error, t.updated_at
  from private.google_oauth_tokens t
  where t.user_id = p_user_id
  limit 1;
$$;
revoke all on function public.srv_get_google_oauth_token(uuid) from public, anon, authenticated;
grant execute on function public.srv_get_google_oauth_token(uuid) to service_role;

create or replace function public.srv_get_institutional_google_oauth_token()
returns table (
  user_id uuid,
  google_email text,
  google_sub text,
  scopes text,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  is_institutional boolean,
  status text,
  last_error text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = private, public
as $$
  select
    t.user_id, t.google_email, t.google_sub, t.scopes,
    t.access_token_enc, t.refresh_token_enc, t.expires_at,
    t.is_institutional, t.status, t.last_error, t.updated_at
  from private.google_oauth_tokens t
  where t.is_institutional = true
  limit 1;
$$;
revoke all on function public.srv_get_institutional_google_oauth_token() from public, anon, authenticated;
grant execute on function public.srv_get_institutional_google_oauth_token() to service_role;

create or replace function public.srv_mark_google_oauth_status(
  p_user_id uuid,
  p_status text,
  p_last_error text default '',
  p_access_token_enc text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_now timestamptz := now();
  v_inst boolean := false;
begin
  update private.google_oauth_tokens
  set status = p_status,
      last_error = coalesce(p_last_error, ''),
      access_token_enc = coalesce(p_access_token_enc, access_token_enc),
      expires_at = coalesce(p_expires_at, expires_at),
      updated_at = v_now
  where user_id = p_user_id
  returning is_institutional into v_inst;

  if coalesce(v_inst, false) then
    update public.drive_sync_state
    set connection_status = case
          when p_status = 'conectado' then 'conectado'
          when p_status = 'requiere_reconexion' then 'requiere_reconexion'
          else 'sin_configurar'
        end,
        actualizado = v_now
    where id = 'global';
  end if;
end;
$$;
revoke all on function public.srv_mark_google_oauth_status(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.srv_mark_google_oauth_status(uuid, text, text, text, timestamptz) to service_role;

create or replace function public.srv_set_institutional_google_oauth(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_now timestamptz := now();
  v_email text;
  v_status text;
  v_has_refresh boolean;
begin
  select google_email, status, (refresh_token_enc <> '')
  into v_email, v_status, v_has_refresh
  from private.google_oauth_tokens
  where user_id = p_user_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Primero conecta tu cuenta de Google Drive.');
  end if;

  if not v_has_refresh then
    return jsonb_build_object(
      'ok', false,
      'error', 'Tu conexión Google Drive no tiene permiso offline (refresh_token). Pulsa "Reconectar Google Drive" para autorizar acceso continuo.'
    );
  end if;

  update private.google_oauth_tokens
  set is_institutional = false, updated_at = v_now
  where is_institutional = true and user_id <> p_user_id;

  update private.google_oauth_tokens
  set is_institutional = true, updated_at = v_now
  where user_id = p_user_id;

  insert into public.drive_sync_state (id, auth_mode, institutional_email, connection_status, actualizado)
  values (
    'global',
    'oauth_institucional',
    coalesce(v_email, ''),
    case when v_status = 'conectado' then 'conectado' else 'requiere_reconexion' end,
    v_now
  )
  on conflict (id) do update
    set auth_mode = 'oauth_institucional',
        institutional_email = excluded.institutional_email,
        connection_status = excluded.connection_status,
        actualizado = v_now;

  return jsonb_build_object('ok', true, 'google_email', coalesce(v_email, ''));
end;
$$;
revoke all on function public.srv_set_institutional_google_oauth(uuid) from public, anon, authenticated;
grant execute on function public.srv_set_institutional_google_oauth(uuid) to service_role;

create or replace function public.srv_delete_google_oauth_token(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_was_inst boolean := false;
begin
  delete from private.google_oauth_tokens
  where user_id = p_user_id
  returning is_institutional into v_was_inst;

  if coalesce(v_was_inst, false) then
    update public.drive_sync_state
    set auth_mode = 'ninguno',
        institutional_email = '',
        connection_status = 'sin_configurar',
        actualizado = now()
    where id = 'global';
  end if;

  return jsonb_build_object('ok', true, 'was_institutional', coalesce(v_was_inst, false));
end;
$$;
revoke all on function public.srv_delete_google_oauth_token(uuid) from public, anon, authenticated;
grant execute on function public.srv_delete_google_oauth_token(uuid) to service_role;

-- 6. Candado atómico anti-concurrencia y cooldown para sincronización automática
create or replace function public.srv_acquire_drive_sync_lock(
  p_lock_seconds integer default 120,
  p_cooldown_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.drive_sync_state%rowtype;
begin
  insert into public.drive_sync_state (id)
  values ('global')
  on conflict (id) do nothing;

  select * into v_row
  from public.drive_sync_state
  where id = 'global'
  for update;

  if v_row.sync_en_curso and v_row.sync_lock_until is not null and v_row.sync_lock_until > v_now then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'en_curso',
      'ultima_sincronizacion', v_row.ultima_sincronizacion
    );
  end if;

  if p_cooldown_seconds > 0
     and v_row.ultima_sincronizacion is not null
     and v_row.ultima_sincronizacion > (v_now - make_interval(secs => p_cooldown_seconds)) then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'reciente',
      'ultima_sincronizacion', v_row.ultima_sincronizacion
    );
  end if;

  update public.drive_sync_state
  set sync_en_curso = true,
      sync_lock_until = v_now + make_interval(secs => greatest(30, p_lock_seconds)),
      actualizado = v_now
  where id = 'global';

  return jsonb_build_object(
    'acquired', true,
    'reason', 'ok',
    'ultima_sincronizacion', v_row.ultima_sincronizacion
  );
end;
$$;
revoke all on function public.srv_acquire_drive_sync_lock(integer, integer) from public, anon, authenticated;
grant execute on function public.srv_acquire_drive_sync_lock(integer, integer) to service_role;

create or replace function public.srv_release_drive_sync_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update public.drive_sync_state
  set sync_en_curso = false,
      sync_lock_until = null,
      actualizado = now()
  where id = 'global';
$$;
revoke all on function public.srv_release_drive_sync_lock() from public, anon, authenticated;
grant execute on function public.srv_release_drive_sync_lock() to service_role;

-- 7. Habilitar Realtime en drive_sync_state para reflejar sincronizaciones de fondo sin F5
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'drive_sync_state'
    ) then
      execute 'alter publication supabase_realtime add table public.drive_sync_state';
    end if;
  end if;
exception when others then
  raise notice 'No se pudo agregar drive_sync_state a supabase_realtime (%).', sqlerrm;
end $$;

-- 8. Programación automática de sync-drive cada 5 min en pg_cron (si pg_cron/pg_net/vault están activos)
do $$
declare
  v_sync_url text;
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    begin
      select coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_sync_url' limit 1),
        replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_notificar_url' limit 1),
          '/notificar-cambios',
          '/sync-drive'
        )
      ) into v_sync_url;

      if v_sync_url is not null and v_sync_url <> '' then
        perform cron.unschedule('cemipre-sync-drive')
        where exists (
          select 1 from cron.job where jobname = 'cemipre-sync-drive'
        );

        perform cron.schedule(
          'cemipre-sync-drive',
          '*/5 * * * *',
          $job$
          select net.http_post(
            url := coalesce(
              (select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_sync_url' limit 1),
              replace(
                (select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_notificar_url' limit 1),
                '/notificar-cambios',
                '/sync-drive'
              )
            ),
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_cron_secret' limit 1), '')
            ),
            body := '{"origen":"pg_cron","auto":true}'::jsonb
          )
          where exists (
            select 1 from vault.decrypted_secrets
            where name in ('cemipre_sync_url', 'cemipre_notificar_url')
          );
          $job$
        );
      end if;
    exception when others then
      raise notice 'No se pudo configurar pg_cron para sync-drive (%). Usa .github/workflows/notificar-cambios.yml.', sqlerrm;
    end;
  end if;
end $$;
