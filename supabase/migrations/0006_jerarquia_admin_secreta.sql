-- Migración 0006: Jerarquía protegida de administradores sin exposición pública en frontend/perfiles

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.superadmins (
  email text primary key,
  creado timestamptz not null default now()
);
revoke all on table private.superadmins from public, anon, authenticated;

create or replace function private.es_superadmin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select exists (
    select 1
    from public.perfiles p
    join private.superadmins s on lower(s.email) = lower(p.email)
    where p.id = coalesce(p_user_id, auth.uid())
      and p.rol = 'admin'
  );
$$;
revoke all on function private.es_superadmin(uuid) from public, anon, authenticated;

-- RPC segura para la sesión actual: solo informa si auth.uid() tiene privilegio de gestión de admins,
-- sin revelar a otros usuarios quién figura en private.superadmins.
create or replace function public.es_superadmin_actual()
returns boolean
language sql
stable
security definer
set search_path = private, public
as $$
  select case
    when auth.uid() is null then false
    else private.es_superadmin(auth.uid())
  end;
$$;
revoke all on function public.es_superadmin_actual() from public, anon;
grant execute on function public.es_superadmin_actual() to authenticated;

-- Reforzar protección de cambios de perfil/rol en public.perfiles
create or replace function public.proteger_cambio_rol()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_actor uuid := auth.uid();
  v_es_super boolean;
begin
  -- SQL Editor / service_role (sin auth.uid()) mantiene control administrativo completo
  if v_actor is null then
    return new;
  end if;

  v_es_super := private.es_superadmin(v_actor);

  if new.email is distinct from old.email then
    raise exception 'No se permite modificar el correo electrónico de un perfil.';
  end if;

  if new.id <> v_actor and old.rol = 'admin' and not v_es_super then
    raise exception 'No tienes permisos para modificar o degradar la cuenta de otro administrador.';
  end if;

  if new.rol is distinct from old.rol then
    if not public.es_admin() then
      raise exception 'Solo un administrador puede modificar el rol de un perfil.';
    end if;

    if old.rol = 'admin' and not v_es_super then
      raise exception 'No tienes permisos para degradar a otro administrador.';
    end if;

    if new.rol = 'admin' and not v_es_super then
      raise exception 'No tienes permisos para asignar el rol de administrador.';
    end if;

    if new.id = v_actor and v_es_super and new.rol <> 'admin' then
      raise exception 'No puedes retirar tu propio rol de administrador principal.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_cambio_rol on public.perfiles;
create trigger trg_proteger_cambio_rol
before update on public.perfiles
for each row execute function public.proteger_cambio_rol();

-- Reforzar lista blanca (emails_autorizados) para que administradores secundarios no preautoricen nuevos admins
create or replace function public.proteger_whitelist_admin()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_actor uuid := auth.uid();
  v_es_super boolean;
begin
  if v_actor is null then
    return coalesce(new, old);
  end if;

  v_es_super := private.es_superadmin(v_actor);

  if tg_op = 'DELETE' then
    if old.rol = 'admin' and not v_es_super then
      raise exception 'No tienes permisos para quitar un administrador de la lista blanca.';
    end if;
    return old;
  end if;

  if (new.rol = 'admin' or (tg_op = 'UPDATE' and old.rol = 'admin')) and not v_es_super then
    raise exception 'No tienes permisos para gestionar preautorizaciones con rol admin.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_whitelist_admin on public.emails_autorizados;
create trigger trg_proteger_whitelist_admin
before insert or update or delete on public.emails_autorizados
for each row execute function public.proteger_whitelist_admin();
