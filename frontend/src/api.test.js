import { describe, it, expect } from 'vitest';
import {
  extractGoogleDocId,
  validateDocsLink,
  validateEventDates,
  validateTextLength,
  mapSummaryResponse,
  mapActivityRow,
  formatApiError,
  hasRealSupabaseConfig,
} from './api.js';

describe('Validación de enlaces Google Docs y extracción de google_doc_id', () => {
  it('extrae correctamente el ID de un enlace HTTPS válido de Google Docs', () => {
    const id = extractGoogleDocId(
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit?usp=sharing',
    );
    expect(id).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz12345');
  });

  it('acepta enlace sin sufijo /edit', () => {
    expect(extractGoogleDocId('https://docs.google.com/document/d/abc1234567890')).toBe('abc1234567890');
  });

  it('rechaza dominios externos y subdominios falsos', () => {
    expect(extractGoogleDocId('https://ejemplo.com/document/d/abc1234567890')).toBeNull();
    expect(extractGoogleDocId('https://docs.google.com.evil.com/document/d/abc1234567890')).toBeNull();
    expect(extractGoogleDocId('https://docs.google.com/spreadsheets/d/abc1234567890/edit')).toBeNull();
  });

  it('rechaza protocolo HTTP no seguro y URLs con credenciales', () => {
    expect(extractGoogleDocId('http://docs.google.com/document/d/abc1234567890/edit')).toBeNull();
    expect(extractGoogleDocId('https://user:pass@docs.google.com/document/d/abc1234567890/edit')).toBeNull();
  });

  it('validateDocsLink permite enlace vacío opcional y valida longitudes > 500', () => {
    expect(validateDocsLink('')).toEqual({ valid: true, googleDocId: '' });
    const tooLong = `https://docs.google.com/document/d/${'a'.repeat(490)}/edit`;
    expect(validateDocsLink(tooLong).valid).toBe(false);

    const valid = validateDocsLink('https://docs.google.com/document/d/doc_9876543210/edit');
    expect(valid.valid).toBe(true);
    expect(valid.googleDocId).toBe('doc_9876543210');
  });
});

describe('Validación de fechas de eventos y campos de texto', () => {
  it('acepta rango de fechas válido donde fin es posterior al inicio', () => {
    const res = validateEventDates('2026-11-15T10:00', '2026-11-15T11:30');
    expect(res.valid).toBe(true);
    expect(res.startIso).toBeTruthy();
    expect(res.endIso).toBeTruthy();
  });

  it('rechaza rangos invertidos, iguales o fechas inválidas', () => {
    expect(validateEventDates('', '2026-11-15T11:30').valid).toBe(false);
    expect(validateEventDates('fecha-mala', '2026-11-15T11:30').valid).toBe(false);
    expect(validateEventDates('2026-11-15T11:30', '2026-11-15T11:30').valid).toBe(false);
    expect(validateEventDates('2026-11-15T12:00', '2026-11-15T11:30').valid).toBe(false);
  });

  it('valida obligatoriedad y longitud máxima de textos', () => {
    expect(validateTextLength('   ', 32, 'Código').valid).toBe(false);
    expect(validateTextLength('x'.repeat(33), 32, 'Código').valid).toBe(false);
    expect(validateTextLength(' USR-001 ', 32, 'Código')).toEqual({ valid: true, value: 'USR-001' });
  });
});

describe('Mapeo de respuestas y manejo de errores', () => {
  it('normaliza la respuesta estructurada de resumen IA', () => {
    const mapped = mapSummaryResponse({
      es_demo: false,
      codigo: 'USR-001',
      nombre: 'Usuario 001',
      cantidad_bitacoras: 7,
      bitacoras_leidas: 5,
      modelo: 'gemini/gemini-3.8-flash',
      estado_general: 'Evolución estable.',
      avances_recientes: [{ punto: 'Participó en taller', fuente: 'Actividades', fecha: '2026-11-10' }],
    });
    expect(mapped.es_demo).toBe(false);
    expect(mapped.bitacoras_leidas).toBe(5);
    expect(mapped.acciones_pendientes).toEqual([]);
    expect(mapped.avances_recientes).toHaveLength(1);
    expect(mapped.aviso_revision).toContain('revisión profesional');
  });

  it('mapea filas de actividad asignando actor por defecto', () => {
    const row = mapActivityRow({ id: 10, descripcion: 'Test', fecha: '2026-11-14T20:00:00Z' });
    expect(row.actor_nombre).toBe('Equipo CEMIPRE');
  });

  it('traduce códigos PostgreSQL y errores JSON de Edge Functions', async () => {
    expect(await formatApiError({ code: '23505' })).toContain('Ya existe');
    expect(await formatApiError({ code: '42501' })).toContain('permisos');
    const edgeErr = {
      context: {
        json: async () => ({ error: 'Sin permiso en carpeta Drive' }),
      },
    };
    expect(await formatApiError(edgeErr)).toBe('Sin permiso en carpeta Drive');
  });

  it('detecta placeholders de ejemplo y exige URL y clave reales de Supabase', () => {
    expect(hasRealSupabaseConfig('https://tu-proyecto.supabase.co', 'tu-clave-anon-publica-de-supabase')).toBe(false);
    expect(hasRealSupabaseConfig('', '')).toBe(false);
    expect(hasRealSupabaseConfig('https://abcd1234.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(true);
  });
});
