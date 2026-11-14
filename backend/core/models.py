from django.db import models


class Persona(models.Model):
    """Usuario atendido por CEMIPRE; nunca se debe usar información real en demo."""
    codigo = models.CharField(max_length=32, unique=True)
    nombre = models.CharField(max_length=120)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['codigo']

    def __str__(self):
        return self.nombre


class Bitacora(models.Model):
    persona = models.ForeignKey(Persona, related_name='bitacoras', on_delete=models.CASCADE)
    titulo = models.CharField(max_length=160)
    # Link hacia Docs; NO guardamos el documento original ni lo editamos desde Django.
    url_docs = models.URLField(max_length=500, blank=True)
    # Solo demostración: reemplazar por lectura autorizada desde Google Docs.
    extracto_demo = models.TextField(blank=True)
    actualizada = models.DateTimeField(auto_now=True)
    orden = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['orden', 'id']

    def __str__(self):
        return f'{self.persona.codigo} - {self.titulo}'


class Evento(models.Model):
    titulo = models.CharField(max_length=160)
    descripcion = models.TextField(blank=True)
    inicio = models.DateTimeField()
    fin = models.DateTimeField()
    responsable = models.CharField(max_length=120, default='Equipo CEMIPRE')
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['inicio']


class Actividad(models.Model):
    """Cambios DE ESTA PLATAFORMA, NO cambios dentro de Google Docs."""
    descripcion = models.CharField(max_length=250)
    persona = models.ForeignKey(Persona, null=True, blank=True, on_delete=models.SET_NULL)
    bitacora = models.ForeignKey(Bitacora, null=True, blank=True, on_delete=models.SET_NULL)
    fecha = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-id']
