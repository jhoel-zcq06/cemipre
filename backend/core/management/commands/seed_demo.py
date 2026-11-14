"""Crea datos totalmente inventados, sin información personal real."""
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import Bitacora, Evento, Persona


BITACORAS = [
    ('Seguimiento general', 'Registro ficticio: actividades de acompañamiento realizadas y próximas acciones.'),
    ('Orientación', 'Registro ficticio: se coordinó una sesión informativa y se entregó material de apoyo.'),
    ('Actividades', 'Registro ficticio: participación en talleres y actividades comunitarias.'),
    ('Evaluación', 'Registro ficticio: revisión de objetivos del período.'),
    ('Coordinación', 'Registro ficticio: contacto con el equipo para definir tareas.'),
    ('Apoyos', 'Registro ficticio: identificación de apoyos y recursos disponibles.'),
    ('Observaciones', 'Registro ficticio: notas generales pendientes de validación por el equipo.'),
]


class Command(BaseCommand):
    help = 'Crear personas, bitácoras y eventos DE EJEMPLO de manera idempotente.'

    def handle(self, *args, **kwargs):
        for index in range(1, 4):
            code = f'USR-{index:03}'
            persona, _ = Persona.objects.get_or_create(codigo=code, defaults={'nombre': f'Usuario {index:03}'})
            for order, (title, excerpt) in enumerate(BITACORAS):
                Bitacora.objects.get_or_create(
                    persona=persona, titulo=title,
                    defaults={'orden': order, 'extracto_demo': excerpt},
                )
        if not Evento.objects.exists():
            first = timezone.localtime(timezone.now()).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=2)
            Evento.objects.create(titulo='Reunión de coordinación (demo)',
                                  descripcion='Evento ficticio de demostración.',
                                  inicio=first, fin=first + timedelta(hours=1),
                                  responsable='Equipo CEMIPRE')
        self.stdout.write(self.style.SUCCESS('Datos ficticios creados. Comando seguro para repetir.'))
