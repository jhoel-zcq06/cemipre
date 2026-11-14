# Generated for the CEMIPRE demo project; maintained alongside models.py.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Persona',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('codigo', models.CharField(max_length=32, unique=True)),
                ('nombre', models.CharField(max_length=120)),
                ('creado', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['codigo']},
        ),
        migrations.CreateModel(
            name='Evento',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('titulo', models.CharField(max_length=160)),
                ('descripcion', models.TextField(blank=True)),
                ('inicio', models.DateTimeField()),
                ('fin', models.DateTimeField()),
                ('responsable', models.CharField(default='Equipo CEMIPRE', max_length=120)),
                ('creado', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['inicio']},
        ),
        migrations.CreateModel(
            name='Bitacora',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('titulo', models.CharField(max_length=160)),
                ('url_docs', models.URLField(blank=True, max_length=500)),
                ('extracto_demo', models.TextField(blank=True)),
                ('actualizada', models.DateTimeField(auto_now=True)),
                ('orden', models.PositiveSmallIntegerField(default=0)),
                ('persona', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='bitacoras', to='core.persona')),
            ],
            options={'ordering': ['orden', 'id']},
        ),
        migrations.CreateModel(
            name='Actividad',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('descripcion', models.CharField(max_length=250)),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('bitacora', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='core.bitacora')),
                ('persona', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='core.persona')),
            ],
            options={'ordering': ['-fecha', '-id']},
        ),
    ]
