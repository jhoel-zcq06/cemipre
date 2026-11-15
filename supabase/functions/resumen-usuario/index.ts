import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import {
  exportDocAsText,
  getFileMetadata,
  getGoogleAccessToken,
  GoogleApiError,
} from '../_shared/google.ts';
import { AuthError, requireAuthorizedWorker } from '../_shared/supabase.ts';

interface PersonaRow {
  id: number;
  codigo: string;
  nombre: string;
}

interface BitacoraRow {
  id: number;
  titulo: string;
  google_doc_id: string;
  url_docs: string;
  orden: number;
  actualizada: string;
  drive_modified_time: string | null;
}

interface FuenteEstado {
  bitacora_id: number;
  titulo: string;
  fecha: string;
  estado: 'leida' | 'vacia' | 'sin_enlace' | 'sin_permiso' | 'no_encontrada' | 'error';
  detalle: string;
  textoMinimizado?: string;
}

interface ResumenEstructurado {
  estado_general: string;
  avances_recientes: Array<{ punto: string; fuente: string; fecha: string }>;
  acciones_pendientes: Array<{ accion: string; fuente: string }>;
  incertidumbres: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Minimización de datos identificatorios antes de enviar texto al proveedor de IA (AI-03).
 */
function minimizeClinicalText(rawText: string, persona: PersonaRow): string {
  let text = rawText;
  // Redactar RUT chileno
  text = text.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT-OMITIDO]');
  // Redactar correos electrónicos
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL-OMITIDO]');
  // Redactar teléfonos móviles chilenos o similares
  text = text.replace(/(?:\+?56\s*)?9[\s-]?\d{4}[\s-]?\d{4}\b/g, '[TELEFONO-OMITIDO]');
  // Reemplazar nombre completo por código anónimo
  const cleanName = persona.nombre.trim();
  if (cleanName.length >= 4 && !cleanName.toLowerCase().startsWith('usuario ')) {
    text = text.replace(new RegExp(escapeRegex(cleanName), 'gi'), `Usuario ${persona.codigo}`);
  }
  return text.trim();
}

function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.45);
  const tail = Math.floor(maxChars * 0.5);
  return {
    text: `${text.slice(0, head)}\n\n[... contenido intermedio omitido por límite de longitud ...]\n\n${text.slice(-tail)}`,
    truncated: true,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function detectAiProvider(apiKey: string): 'gemini' | 'openai' {
  const configured = (Deno.env.get('AI_PROVIDER') || '').trim().toLowerCase();
  if (configured === 'openai' || configured === 'gemini') return configured;
  if (apiKey.startsWith('sk-')) return 'openai';
  return 'gemini';
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callAiPrompt(prompt: string, systemPrompt: string): Promise<{ text: string; modelUsed: string }> {
  const apiKey = (Deno.env.get('AI_API_KEY') || '').trim();
  if (!apiKey) {
    throw new Error('Falta configurar el secreto AI_API_KEY en Supabase Edge Functions.');
  }

  const provider = detectAiProvider(apiKey);
  if (provider === 'openai') {
    const model = (Deno.env.get('AI_MODEL') || 'gpt-4o-mini').trim();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI respondió ${res.status}: ${errText.slice(0, 200)}`);
    }
    const payload = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return {
      text: payload.choices?.[0]?.message?.content ?? '{}',
      modelUsed: `openai/${model}`,
    };
  }

  const model = (Deno.env.get('AI_MODEL') || 'gemini-3.5-flash-lite').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    responseMimeType: 'application/json',
  };
  if (/^gemini-3([.-]|$)/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`El modelo ${model} tardó demasiado en responder (timeout 45s). Prueba con AI_MODEL="gemini-3.5-flash-lite".`);
    }
    throw err;
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini respondió ${res.status}: ${errText.slice(0, 200)}`);
  }
  const payload = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return {
    text: payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '{}',
    modelUsed: `gemini/${model}`,
  };
}

const SYSTEM_PROMPT = `Eres un asistente técnico para trabajadores sociales y profesionales de la Fundación CEMIPRE (atención a personas con ceguera y baja visión).
Reglas estrictas:
1. Basa tu síntesis ÚNICAMENTE en el texto real de las bitácoras entregadas.
2. Nunca inventes fechas, diagnósticos, nombres, apoyos ni hechos que no aparezcan explícitamente en el texto.
3. Si falta información, hay ambigüedad o alguna bitácora estuvo inaccesible/vacía, decláralo en "incertidumbres".
4. Cita siempre la bitácora de origen en "fuente" (y su fecha si consta).
5. Responde EXCLUSIVAMENTE en JSON válido con esta estructura exacta:
{
  "estado_general": "Párrafo breve y claro del panorama general actual",
  "avances_recientes": [{"punto": "...", "fuente": "Nombre bitácora", "fecha": "Fecha o 'Sin fecha explícita'"}],
  "acciones_pendientes": [{"accion": "...", "fuente": "Nombre bitácora"}],
  "incertidumbres": ["..."]
}`;

function parseStructuredSummary(rawText: string): ResumenEstructurado {
  try {
    const parsed = JSON.parse(stripJsonFences(rawText)) as Partial<ResumenEstructurado>;
    return {
      estado_general: typeof parsed.estado_general === 'string' && parsed.estado_general.trim()
        ? parsed.estado_general.trim()
        : 'No se pudo generar un estado general claro a partir de los documentos.',
      avances_recientes: Array.isArray(parsed.avances_recientes) ? parsed.avances_recientes : [],
      acciones_pendientes: Array.isArray(parsed.acciones_pendientes) ? parsed.acciones_pendientes : [],
      incertidumbres: Array.isArray(parsed.incertidumbres) ? parsed.incertidumbres : [],
    };
  } catch {
    return {
      estado_general: rawText.trim().slice(0, 1200) || 'Respuesta de IA con formato no estructurado.',
      avances_recientes: [],
      acciones_pendientes: [],
      incertidumbres: ['La respuesta del modelo no siguió exactamente el esquema JSON esperado; revisar fuentes originales.'],
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido. Usa POST.', 405);
  }

  try {
    const { userId, perfil, adminClient } = await requireAuthorizedWorker(req);

    let body: { persona_id?: number };
    try {
      body = await req.json() as { persona_id?: number };
    } catch {
      return errorResponse('El cuerpo debe ser JSON válido con persona_id.');
    }

    const personaId = Number(body?.persona_id);
    if (!Number.isInteger(personaId) || personaId <= 0) {
      return errorResponse('persona_id inválido.');
    }

    const { data: personaData, error: personaErr } = await adminClient
      .from('personas')
      .select('id, codigo, nombre')
      .eq('id', personaId)
      .maybeSingle();

    if (personaErr || !personaData) {
      return errorResponse('Persona no encontrada.', 404);
    }
    const persona = personaData as PersonaRow;

    const { data: bitacorasData, error: bitacorasErr } = await adminClient
      .from('bitacoras')
      .select('id, titulo, google_doc_id, url_docs, orden, actualizada, drive_modified_time')
      .eq('persona_id', personaId)
      .order('orden', { ascending: true })
      .order('id', { ascending: true });

    if (bitacorasErr) {
      return errorResponse(`Error consultando bitácoras: ${bitacorasErr.message}`, 500);
    }

    const bitacoras = (bitacorasData ?? []) as BitacoraRow[];
    const linked = bitacoras.filter((b) => b.google_doc_id.trim() !== '');

    let token = '';
    if (linked.length > 0) {
      token = await getGoogleAccessToken();
    }

    const fuentes: FuenteEstado[] = await mapPool(bitacoras, 3, async (b): Promise<FuenteEstado> => {
      const docId = b.google_doc_id.trim();
      const baseFecha = b.drive_modified_time || b.actualizada;
      if (!docId) {
        return {
          bitacora_id: b.id,
          titulo: b.titulo,
          fecha: baseFecha,
          estado: 'sin_enlace',
          detalle: 'Bitácora sin enlace de Google Docs vinculado.',
        };
      }

      try {
        const [meta, rawContent] = await Promise.all([
          getFileMetadata(docId, token),
          exportDocAsText(docId, token),
        ]);
        const fechaDoc = meta.modifiedTime || baseFecha;
        if (meta.trashed) {
          return {
            bitacora_id: b.id,
            titulo: b.titulo,
            fecha: fechaDoc,
            estado: 'no_encontrada',
            detalle: 'El documento se encuentra en la papelera de Google Drive.',
          };
        }
        const minimized = minimizeClinicalText(rawContent, persona);
        if (!minimized) {
          return {
            bitacora_id: b.id,
            titulo: b.titulo,
            fecha: fechaDoc,
            estado: 'vacia',
            detalle: 'El Google Doc está vacío o no contiene texto legible.',
          };
        }
        return {
          bitacora_id: b.id,
          titulo: b.titulo,
          fecha: fechaDoc,
          estado: 'leida',
          detalle: `Leída correctamente (${minimized.length} caracteres).`,
          textoMinimizado: minimized,
        };
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          return {
            bitacora_id: b.id,
            titulo: b.titulo,
            fecha: baseFecha,
            estado: 'sin_permiso',
            detalle: err.message,
          };
        }
        if (err instanceof GoogleApiError && err.code === 'no_encontrada') {
          return {
            bitacora_id: b.id,
            titulo: b.titulo,
            fecha: baseFecha,
            estado: 'no_encontrada',
            detalle: err.message,
          };
        }
        return {
          bitacora_id: b.id,
          titulo: b.titulo,
          fecha: baseFecha,
          estado: 'error',
          detalle: (err as Error).message,
        };
      }
    });

    const leidas = fuentes.filter((f) => f.estado === 'leida' && f.textoMinimizado);
    const advertenciasPrevias = fuentes
      .filter((f) => f.estado !== 'leida')
      .map((f) => `${f.titulo}: ${f.detalle}`);

    if (leidas.length === 0) {
      return jsonResponse({
        es_demo: false,
        codigo: persona.codigo,
        nombre: persona.nombre,
        cantidad_bitacoras: bitacoras.length,
        bitacoras_leidas: 0,
        generado_en: new Date().toISOString(),
        modelo: 'sin_llamada_ia',
        aviso_revision: 'No se encontró texto legible en Google Docs vinculados. No se generó contenido inventado.',
        estado_general: 'No hay documentos de Google Docs con texto legible disponibles para generar el resumen.',
        avances_recientes: [],
        acciones_pendientes: [],
        incertidumbres: advertenciasPrevias.length > 0
          ? advertenciasPrevias
          : ['Agrega enlaces válidos de Google Docs compartidos con la Service Account para habilitar los resúmenes.'],
        fuentes: fuentes.map(({ textoMinimizado: _omit, ...rest }) => rest),
      });
    }

    // Manejo de documentos largos por bloques si supera el presupuesto seguro
    const MAX_PER_DOC = 10_000;
    const MAX_COMBINED = 32_000;
    let truncatedAny = false;

    const bloquesDoc = leidas.map((f) => {
      const cut = truncateMiddle(f.textoMinimizado || '', MAX_PER_DOC);
      if (cut.truncated) truncatedAny = true;
      return `=== BITÁCORA: ${f.titulo} (Última modificación: ${f.fecha}) ===\n${cut.text}`;
    });

    let contextoParaSintesis = bloquesDoc.join('\n\n');
    let modelUsed = '';

    if (contextoParaSintesis.length > MAX_COMBINED) {
      // Síntesis en dos etapas para historiales muy extensos
      const chunks: string[] = [];
      let current = '';
      for (const block of bloquesDoc) {
        if ((current + '\n\n' + block).length > 20_000 && current) {
          chunks.push(current);
          current = block;
        } else {
          current = current ? `${current}\n\n${block}` : block;
        }
      }
      if (current) chunks.push(current);

      const partialSummaries: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const resChunk = await callAiPrompt(
          `Usuario anónimo: ${persona.codigo}\nBloque ${i + 1} de ${chunks.length}:\n\n${chunks[i]}`,
          SYSTEM_PROMPT,
        );
        modelUsed = resChunk.modelUsed;
        partialSummaries.push(`Resumen parcial bloque ${i + 1}:\n${resChunk.text}`);
      }
      contextoParaSintesis = partialSummaries.join('\n\n');
      truncatedAny = true;
    }

    const finalPrompt = `Usuario anónimo: ${persona.codigo}
Bitácoras disponibles con texto (${leidas.length} de ${bitacoras.length}):
Bitácoras NO disponibles/vacías: ${advertenciasPrevias.length > 0 ? advertenciasPrevias.join(' | ') : 'Ninguna'}

Contenido minimizado de bitácoras:
${contextoParaSintesis}`;

    const aiResponse = await callAiPrompt(finalPrompt, SYSTEM_PROMPT);
    modelUsed = aiResponse.modelUsed;
    const estructurado = parseStructuredSummary(aiResponse.text);

    const incertidumbres = [
      ...estructurado.incertidumbres,
      ...advertenciasPrevias,
      ...(truncatedAny
        ? ['Algunos documentos extensos fueron condensados/recortados por longitud; revisar las bitácoras originales para detalle completo.']
        : []),
    ];

    // Auditoría sin guardar texto clínico ni prompts completos (AI-03)
    await adminClient.from('actividad').insert({
      descripcion: `Generó resumen IA para ${persona.codigo} (${leidas.length}/${bitacoras.length} bitácoras leídas).`,
      persona_id: persona.id,
      actor_id: userId,
      actor_nombre: perfil.nombre || perfil.email,
    });

    return jsonResponse({
      es_demo: false,
      codigo: persona.codigo,
      nombre: persona.nombre,
      cantidad_bitacoras: bitacoras.length,
      bitacoras_leidas: leidas.length,
      generado_en: new Date().toISOString(),
      modelo: modelUsed,
      aviso_revision: 'Resumen asistido por IA a partir de Google Docs reales (con minimización previa). Requiere revisión profesional antes de tomar decisiones.',
      estado_general: estructurado.estado_general,
      avances_recientes: estructurado.avances_recientes,
      acciones_pendientes: estructurado.acciones_pendientes,
      incertidumbres: Array.from(new Set(incertidumbres)),
      fuentes: fuentes.map(({ textoMinimizado: _omit, ...rest }) => rest),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.status);
    }
    if (err instanceof GoogleApiError) {
      return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
    }
    return errorResponse(`Error generando resumen IA: ${(err as Error).message}`, 500);
  }
});
