-- Migración 0002: Autenticación, Perfiles, Roles, Auditoría y Políticas RLS estrictas (SEC-01 / SEC-02 / OPS-02)

-- 1. Tabla de perfiles vinculada a Supabase Auth
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nombre text not null default '',
  rol text not null default 'pendiente' check (rol in ('admin', 'trabajador', 'pendiente')),
  recibir_notificaciones boolean not null default true,
  creado timestamptz not null default now()
);

-- Lista blanca opcional administrada solo por 'admin' para asignar rol automático al registrarse
create table if not exists public.emails_autorizados (
  email text primary key,
  rol text not null default 'trabajador' check (rol in ('admin', 'trabajador')),
  agregado_en timestamptz not null default now()
);

-- 2. Auditoría por trabajador en actividad
alter table public.actividad
  add column if not exists actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists actor_nombre text not null default '';

-- 3. Funciones auxiliares seguras para políticas RLS
create or replace function public.es_trabajador_autorizado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.rol in ('admin', 'trabajador')
  );
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.rol = 'admin'
  );
$$;

-- 4. Trigger automático al crear usuario en auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_nombre text;
  v_rol text := 'pendiente';
  v_whitelist_rol text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
    split_part(v_email, '@', 1)
  );

  select ea.rol into v_whitelist_rol
  from public.emails_autorizados ea
  where lower(ea.email) = v_email
  limit 1;

  if v_whitelist_rol in ('admin', 'trabajador') then
    v_rol := v_whitelist_rol;
  end if;

  insert into public.perfiles (id, email, nombre, rol)
  values (new.id, v_email, v_nombre, v_rol)
  on conflict (id) do update
    set email = excluded.email,
        nombre = case when public.perfiles.nombre = '' then excluded.nombre else public.perfiles.nombre end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill seguro por si ya existían usuarios en auth.users antes de aplicar esta migración
insert into public.perfiles (id, email, nombre, rol)
select
  u.id,
  lower(coalesce(u.email, u.id::text || '@sin-email.local')),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(u.email, ''), '@', 1)
  ),
  coalesce((
    select ea.rol from public.emails_autorizados ea
    where lower(ea.email) = lower(coalesce(u.email, ''))
    limit 1
  ), 'pendiente')
from auth.users u
on conflict (id) do nothing;

-- 5. Evitar escalación de privilegios: un trabajador no puede cambiarse su propio rol
create or replace function public.proteger_cambio_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol is distinct from old.rol then
    -- auth.uid() es null cuando se ejecuta desde SQL Editor / service_role
    if auth.uid() is not null and not public.es_admin() then
      raise exception 'Solo un administrador puede modificar el rol de un perfil.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_cambio_rol on public.perfiles;
create trigger trg_proteger_cambio_rol
before update on public.perfiles
for each row execute function public.proteger_cambio_rol();

-- 6. Eliminar políticas temporales abiertas si existieran
drop policy if exists demo_personas_all on public.personas;
drop policy if exists demo_bitacoras_all on public.bitacoras;
drop policy if exists demo_eventos_all on public.eventos;
drop policy if exists demo_actividad_all on public.actividad;

-- 7. Habilitar RLS en nuevas tablas y definir políticas estrictas
alter table public.perfiles enable row level security;
alter table public.emails_autorizados enable row level security;
alter table public.personas enable row level security;
alter table public.bitacoras enable row level security;
alter table public.eventos enable row level security;
alter table public.actividad enable row level security;

-- Políticas de perfiles
drop policy if exists perfiles_select_propio_o_equipo on public.perfiles;
create policy perfiles_select_propio_o_equipo
on public.perfiles for select
using (auth.uid() = id or public.es_trabajador_autorizado());

drop policy if exists perfiles_update_propio_o_admin on public.perfiles;
create policy perfiles_update_propio_o_admin
on public.perfiles for update
using (auth.uid() = id or public.es_admin())
with check (auth.uid() = id or public.es_admin());

-- Políticas de emails_autorizados (solo admin)
drop policy if exists emails_autorizados_admin on public.emails_autorizados;
create policy emails_autorizados_admin
on public.emails_autorizados for all
using (public.es_admin())
with check (public.es_admin());

-- Políticas de personas (lectura/creación/edición trabajadores; eliminación solo admin)
drop policy if exists personas_select_autorizado on public.personas;
create policy personas_select_autorizado
on public.personas for select
using (public.es_trabajador_autorizado());

drop policy if exists personas_insert_autorizado on public.personas;
create policy personas_insert_autorizado
on public.personas for insert
with check (public.es_trabajador_autorizado());

drop policy if exists personas_update_autorizado on public.personas;
create policy personas_update_autorizado
on public.personas for update
using (public.es_trabajador_autorizado())
with check (public.es_trabajador_autorizado());

drop policy if exists personas_delete_admin on public.personas;
create policy personas_delete_admin
on public.personas for delete
using (public.es_admin());

-- Políticas de bitácoras
drop policy if exists bitacoras_select_autorizado on public.bitacoras;
create policy bitacoras_select_autorizado
on public.bitacoras for select
using (public.es_trabajador_autorizado());

drop policy if exists bitacoras_insert_autorizado on public.bitacoras;
create policy bitacoras_insert_autorizado
on public.bitacoras for insert
with check (public.es_trabajador_autorizado());

drop policy if exists bitacoras_update_autorizado on public.bitacoras;
create policy bitacoras_update_autorizado
on public.bitacoras for update
using (public.es_trabajador_autorizado())
with check (public.es_trabajador_autorizado());

drop policy if exists bitacoras_delete_autorizado on public.bitacoras;
create policy bitacoras_delete_autorizado
on public.bitacoras for delete
using (public.es_trabajador_autorizado());

-- Políticas de eventos
drop policy if exists eventos_select_autorizado on public.eventos;
create policy eventos_select_autorizado
on public.eventos for select
using (public.es_trabajador_autorizado());

drop policy if exists eventos_insert_autorizado on public.eventos;
create policy eventos_insert_autorizado
on public.eventos for insert
with check (public.es_trabajador_autorizado());

drop policy if exists eventos_update_autorizado on public.eventos;
create policy eventos_update_autorizado
on public.eventos for update
using (public.es_trabajador_autorizado())
with check (public.es_trabajador_autorizado());

drop policy if exists eventos_delete_autorizado on public.eventos;
create policy eventos_delete_autorizado
on public.eventos for delete
using (public.es_trabajador_autorizado());

-- Políticas de actividad (solo lectura e inserción autenticada; inmutable)
drop policy if exists actividad_select_autorizado on public.actividad;
create policy actividad_select_autorizado
on public.actividad for select
using (public.es_trabajador_autorizado());

drop policy if exists actividad_insert_autorizado on public.actividad;
create policy actividad_insert_autorizado
on public.actividad for insert
with check (
  public.es_trabajador_autorizado()
  and (actor_id is null or actor_id = auth.uid())
);
