-- Datos FICTICIOS de desarrollo para CEMIPRE.
-- ADVERTENCIA: Nunca insertar nombres, RUTs, teléfonos ni historiales reales aquí.

insert into public.personas (codigo, nombre)
values
  ('USR-001', 'Usuario 001 (Demo)'),
  ('USR-002', 'Usuario 002 (Demo)'),
  ('USR-003', 'Usuario 003 (Demo)')
on conflict (codigo) do nothing;

with bitacoras_base(titulo, extracto, orden) as (
  values
    ('Seguimiento general', 'Registro ficticio: actividades de acompañamiento realizadas y próximas acciones.', 0),
    ('Orientación', 'Registro ficticio: se coordinó una sesión informativa y se entregó material de apoyo.', 1),
    ('Actividades', 'Registro ficticio: participación en talleres y actividades comunitarias.', 2),
    ('Evaluación', 'Registro ficticio: revisión de objetivos del período.', 3),
    ('Coordinación', 'Registro ficticio: contacto con el equipo para definir tareas.', 4),
    ('Apoyos', 'Registro ficticio: identificación de apoyos y recursos disponibles.', 5),
    ('Observaciones', 'Registro ficticio: notas generales pendientes de validación por el equipo.', 6)
)
insert into public.bitacoras (persona_id, titulo, extracto_demo, orden, estado_sync)
select p.id, b.titulo, b.extracto, b.orden, 'sin_enlace'
from public.personas p
cross join bitacoras_base b
where p.codigo in ('USR-001', 'USR-002', 'USR-003')
  and not exists (
    select 1 from public.bitacoras existing
    where existing.persona_id = p.id and existing.titulo = b.titulo
  );

insert into public.eventos (titulo, descripcion, inicio, fin, responsable)
select
  'Reunión de coordinación (demo)',
  'Evento ficticio de demostración para probar el calendario compartido.',
  date_trunc('day', now()) + interval '2 days' + interval '10 hours',
  date_trunc('day', now()) + interval '2 days' + interval '11 hours',
  'Equipo CEMIPRE'
where not exists (
  select 1 from public.eventos where titulo = 'Reunión de coordinación (demo)'
);

insert into public.actividad (descripcion, actor_nombre)
select
  'Base de datos inicializada con datos ficticios de demostración.',
  'Sistema'
where not exists (select 1 from public.actividad);
