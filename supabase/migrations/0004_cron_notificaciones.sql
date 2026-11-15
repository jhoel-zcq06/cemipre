-- Migración 0004: Programación periódica para notificar-cambios (NOT-01 / NOT-03)
-- En Supabase Pro/Teams puedes usar pg_cron + pg_net junto a Supabase Vault.
-- En Supabase Free Tier (si pg_net no está disponible), usa el workflow incluido en:
--   .github/workflows/notificar-cambios.yml
--
-- Antes de activar este bloque en producción, guarda estos secretos en Supabase Vault:
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/notificar-cambios', 'cemipre_notificar_url');
--   select vault.create_secret('<TU_CRON_SECRET>', 'cemipre_cron_secret');

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_cron;
      create extension if not exists pg_net;

      if exists (select 1 from pg_namespace where nspname = 'cron')
         and exists (select 1 from pg_namespace where nspname = 'vault') then
        perform cron.unschedule('cemipre-notificar-cambios')
        where exists (
          select 1 from cron.job where jobname = 'cemipre-notificar-cambios'
        );

        perform cron.schedule(
          'cemipre-notificar-cambios',
          '*/10 * * * *',
          $job$
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_notificar_url' limit 1),
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cemipre_cron_secret' limit 1), '')
            ),
            body := '{"origen":"pg_cron"}'::jsonb
          )
          where exists (
            select 1 from vault.decrypted_secrets where name = 'cemipre_notificar_url'
          );
          $job$
        );
      end if;
    exception when others then
      raise notice 'No se pudo configurar pg_cron automáticamente (%). Usa .github/workflows/notificar-cambios.yml.', sqlerrm;
    end;
  else
    raise notice 'pg_cron o pg_net no disponibles en esta instancia; usar .github/workflows/notificar-cambios.yml.';
  end if;
end $$;
