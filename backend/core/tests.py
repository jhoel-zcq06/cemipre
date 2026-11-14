import json
from datetime import timedelta
from django.test import TestCase, Client
from django.utils import timezone
from .models import Bitacora, Persona


class ApiTests(TestCase):
    def setUp(self):
        self.p = Persona.objects.create(codigo='TEST-01', nombre='Persona de prueba')
        self.b = Bitacora.objects.create(persona=self.p, titulo='Seguimiento')

    def test_persona_y_bitacoras(self):
        response = self.client.get(f'/api/personas/{self.p.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['bitacoras']), 1)

    def test_no_admite_enlace_externo(self):
        response = self.client.patch(
            f'/api/bitacoras/{self.b.id}/',
            data=json.dumps({'url_docs': 'https://ejemplo.com/archivo'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_actualizar_enlace_docs(self):
        url = 'https://docs.google.com/document/d/abc123/edit'
        response = self.client.patch(
            f'/api/bitacoras/{self.b.id}/',
            data=json.dumps({'url_docs': url}), content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.b.refresh_from_db()
        self.assertEqual(self.b.url_docs, url)

    def test_resumen_declara_que_no_es_ia(self):
        response = self.client.get(f'/api/personas/{self.p.id}/resumen/')
        self.assertTrue(response.json()['es_demo'])

    def test_evento_valido(self):
        inicio = timezone.now()
        fin = inicio + timedelta(hours=1)
        response = self.client.post('/api/eventos/', data=json.dumps({
            'titulo': 'Reunión', 'inicio': inicio.isoformat(), 'fin': fin.isoformat(),
        }), content_type='application/json')
        self.assertEqual(response.status_code, 201)

    def test_csrf_es_obligatorio_en_escrituras(self):
        cliente = Client(enforce_csrf_checks=True)
        response = cliente.post('/api/personas/', data=json.dumps({
            'codigo': 'NUEVO', 'nombre': 'Nuevo usuario',
        }), content_type='application/json')
        self.assertEqual(response.status_code, 403)
