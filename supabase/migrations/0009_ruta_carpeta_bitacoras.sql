-- Migración 0009: Ruta de carpeta de origen en Google Drive para cada bitácora.
-- 100% aditiva e idempotente: segura para aplicar en bases de datos con datos existentes.

alter table public.bitacoras
  add column if not exists drive_folder_path text not null default '';
