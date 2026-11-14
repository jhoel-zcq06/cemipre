from django.urls import path
from . import views

urlpatterns = [
    path('health/', views.health),
    path('csrf/', views.csrf_cookie),
    path('personas/', views.personas),
    path('personas/<int:persona_id>/', views.persona_detalle),
    path('personas/<int:persona_id>/resumen/', views.resumen_demo),
    path('bitacoras/', views.crear_bitacora),
    path('bitacoras/<int:bitacora_id>/', views.actualizar_bitacora),
    path('eventos/', views.eventos),
    path('eventos/<int:evento_id>/', views.eliminar_evento),
    path('actividad/', views.actividad),
]
