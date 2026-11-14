"""API JSON sin dependencias extra.

ADVERTENCIA: No tiene autenticación. No publicar con datos reales.
Una fase posterior requerirá OAuth/sesiones, permisos y auditoría por trabajador.
"""
import json
from urllib.parse import urlparse

from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .models import Actividad, Bitacora, Evento, Persona


def error(message, status=400):
    return JsonResponse({'error': message}, status=status)


def body_json(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def valid_string(value, max_length):
    return isinstance(value, str) and 0 < len(value.strip()) <= max_length


def valid_docs_link(value):
    if value == '':
        return True
    if not isinstance(value, str) or len(value) > 500:
        return False
    parsed = urlparse(value)
    return (
        parsed.scheme == 'https'
        and parsed.hostname == 'docs.google.com'
        and parsed.path.startswith('/document/d/')
        and parsed.username is None
        and parsed.password is None
    )


def bitacora_json(bitacora):
    return {
        'id': bitacora.id,
        'titulo': bitacora.titulo,
        'url_docs': bitacora.url_docs,
        'actualizada': bitacora.actualizada.isoformat(),
    }


def evento_json(evento):
    return {
        'id': evento.id, 'titulo': evento.titulo, 'descripcion': evento.descripcion,
        'inicio': evento.inicio.isoformat(), 'fin': evento.fin.isoformat(),
        'responsable': evento.responsable,
    }


@require_http_methods(['GET'])
def health(request):
    return JsonResponse({'status': 'ok', 'modo': 'demo_local'})


@ensure_csrf_cookie
@require_http_methods(['GET'])
def csrf_cookie(request):
    return JsonResponse({'ok': True})


@require_http_methods(['GET', 'POST'])
def personas(request):
    if request.method == 'GET':
        result = Persona.objects.annotate(total_bitacoras=Count('bitacoras'))
        return JsonResponse({'personas': [
            {'id': p.id, 'codigo': p.codigo, 'nombre': p.nombre,
             'total_bitacoras': p.total_bitacoras} for p in result
        ]})

    data = body_json(request)
    if not data:
        return error('El cuerpo debe ser un objeto JSON.')
    if not valid_string(data.get('codigo'), 32) or not valid_string(data.get('nombre'), 120):
        return error('Código y nombre obligatorios; verifica sus longitudes.')
    codigo = data['codigo'].strip()
    if Persona.objects.filter(codigo__iexact=codigo).exists():
        return error('Ya existe un usuario con ese código.', 409)
    persona = Persona.objects.create(codigo=codigo, nombre=data['nombre'].strip())
    Actividad.objects.create(descripcion=f'Se creó el registro {persona.codigo}.', persona=persona)
    return JsonResponse({'id': persona.id, 'codigo': persona.codigo, 'nombre': persona.nombre}, status=201)


@require_http_methods(['GET'])
def persona_detalle(request, persona_id):
    p = get_object_or_404(Persona.objects.prefetch_related('bitacoras'), pk=persona_id)
    return JsonResponse({'id': p.id, 'codigo': p.codigo, 'nombre': p.nombre,
                         'bitacoras': [bitacora_json(b) for b in p.bitacoras.all()]})


@require_http_methods(['POST'])
def crear_bitacora(request):
    data = body_json(request)
    if not data:
        return error('El cuerpo debe ser un objeto JSON.')
    if not valid_string(data.get('titulo'), 160):
        return error('El título es obligatorio (máximo 160 caracteres).')
    try:
        persona_id = int(data.get('persona_id'))
    except (TypeError, ValueError):
        return error('persona_id inválido.')
    p = get_object_or_404(Persona, pk=persona_id)
    url_docs = data.get('url_docs', '')
    if not valid_docs_link(url_docs):
        return error('Se requiere un enlace HTTPS a docs.google.com/document/d/... o vacío.')
    b = Bitacora.objects.create(persona=p, titulo=data['titulo'].strip(), url_docs=url_docs,
                                orden=p.bitacoras.count())
    Actividad.objects.create(descripcion=f'Se agregó "{b.titulo}" a {p.codigo}.', persona=p, bitacora=b)
    return JsonResponse(bitacora_json(b), status=201)


@require_http_methods(['PATCH'])
def actualizar_bitacora(request, bitacora_id):
    b = get_object_or_404(Bitacora.objects.select_related('persona'), pk=bitacora_id)
    data = body_json(request)
    if not data:
        return error('Se necesita un objeto JSON con los cambios.')
    if 'titulo' not in data and 'url_docs' not in data:
        return error('Solo se pueden cambiar título o enlace de Google Docs.')
    if 'titulo' in data:
        if not valid_string(data['titulo'], 160):
            return error('Título inválido (máximo 160 caracteres).')
        b.titulo = data['titulo'].strip()
    if 'url_docs' in data:
        if not valid_docs_link(data['url_docs']):
            return error('El enlace debe apuntar a https://docs.google.com/document/d/...')
        b.url_docs = data['url_docs']
    b.save()
    Actividad.objects.create(descripcion=f'Se actualizaron datos de "{b.titulo}" ({b.persona.codigo}).',
                             persona=b.persona, bitacora=b)
    # IMPORTANTE: esto NO indica cambios en el contenido real del documento.
    return JsonResponse(bitacora_json(b))


@require_http_methods(['GET'])
def resumen_demo(request, persona_id):
    p = get_object_or_404(Persona.objects.prefetch_related('bitacoras'), pk=persona_id)
    bitacoras = list(p.bitacoras.all())
    # No llamar esto "IA": son extractos ficticios almacenados localmente.
    items = [{'titulo': b.titulo, 'texto': b.extracto_demo or 'Sin información de ejemplo disponible.'}
             for b in bitacoras]
    return JsonResponse({
        'es_demo': True, 'nombre': p.nombre, 'cantidad_bitacoras': len(bitacoras),
        'advertencia': 'Vista de ejemplo. NO se han leído Google Docs ni se ha utilizado IA.',
        'secciones': items,
    })


def parse_date(value):
    if not isinstance(value, str):
        return None
    try:
        dt = parse_datetime(value)
    except ValueError:
        return None
    if dt is not None and timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


@require_http_methods(['GET', 'POST'])
def eventos(request):
    if request.method == 'GET':
        return JsonResponse({'eventos': [evento_json(evento) for evento in Evento.objects.all()]})
    data = body_json(request)
    if not data:
        return error('El cuerpo debe ser un objeto JSON.')
    if not valid_string(data.get('titulo'), 160):
        return error('El título del evento es obligatorio.')
    start = parse_date(data.get('inicio'))
    end = parse_date(data.get('fin'))
    if not start or not end or end <= start:
        return error('Las fechas deben ser válidas y el fin posterior al inicio.')
    desc = data.get('descripcion', '')
    owner = data.get('responsable', 'Equipo CEMIPRE')
    if not isinstance(desc, str) or len(desc) > 2000 or not valid_string(owner, 120):
        return error('Descripción o responsable inválido.')
    evento = Evento.objects.create(titulo=data['titulo'].strip(), descripcion=desc,
                                   inicio=start, fin=end, responsable=owner.strip())
    Actividad.objects.create(descripcion=f'Se creó el evento "{evento.titulo}".')
    return JsonResponse(evento_json(evento), status=201)


@require_http_methods(['DELETE'])
def eliminar_evento(request, evento_id):
    evento = get_object_or_404(Evento, pk=evento_id)
    title = evento.titulo
    evento.delete()
    Actividad.objects.create(descripcion=f'Se eliminó el evento "{title}".')
    return JsonResponse({'ok': True})


@require_http_methods(['GET'])
def actividad(request):
    return JsonResponse({'actividad': [
        {'id': a.id, 'descripcion': a.descripcion, 'fecha': a.fecha.isoformat()}
        for a in Actividad.objects.all()[:30]
    ], 'advertencia': 'Solo muestra modificaciones hechas en esta plataforma; no detecta ediciones en Google Docs.'})
