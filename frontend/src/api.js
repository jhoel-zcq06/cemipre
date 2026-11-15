import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export function hasRealSupabaseConfig(url = supabaseUrl, anonKey = supabaseAnonKey) {
  if (!url || !anonKey) return false;
  if (url.includes('tu-proyecto.supabase.co') || anonKey.includes('tu-clave-anon')) return false;
  return url.startsWith('https://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
}

export const isSupabaseConfigured = hasRealSupabaseConfig();

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const DOC_PATH_REGEX = /^\/document\/d\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/;

/**
 * Extrae el ID estable de un enlace válido de Google Docs.
 * Rechaza esquemas distintos a HTTPS, dominios externos y URLs con credenciales.
 */
export function extractGoogleDocId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'docs.google.com'
    || parsed.username !== ''
    || parsed.password !== ''
  ) {
    return null;
  }
  const match = parsed.pathname.match(DOC_PATH_REGEX);
  return match ? match[1] : null;
}

/**
 * Valida el campo url_docs (permite vacío como opcional).
 */
export function validateDocsLink(value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, googleDocId: '' };
  }
  if (typeof value !== 'string') {
    return { valid: false, googleDocId: '', error: 'El enlace debe ser un texto válido.' };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true, googleDocId: '' };
  }
  if (trimmed.length > 500) {
    return { valid: false, googleDocId: '', error: 'El enlace supera los 500 caracteres permitidos.' };
  }
  const docId = extractGoogleDocId(trimmed);
  if (!docId) {
    return {
      valid: false,
      googleDocId: '',
      error: 'El enlace debe apuntar a https://docs.google.com/document/d/<ID>/... sin credenciales.',
    };
  }
  return { valid: true, googleDocId: docId, normalizedUrl: trimmed };
}

/**
 * Valida que las fechas de un evento sean válidas y el fin sea posterior al inicio.
 */
export function validateEventDates(inicio, fin) {
  if (!inicio || !fin) {
    return { valid: false, error: 'Debes indicar fecha y hora de inicio y fin.' };
  }
  const start = new Date(inicio);
  const end = new Date(fin);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, error: 'Fecha u hora inválida.' };
  }
  if (end.getTime() <= start.getTime()) {
    return { valid: false, error: 'La hora de término debe ser posterior al inicio.' };
  }
  return { valid: true, startIso: start.toISOString(), endIso: end.toISOString() };
}

export function validateTextLength(value, maxLength, label = 'El campo') {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, error: `${label} es obligatorio.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { valid: false, error: `${label} no debe superar ${maxLength} caracteres.` };
  }
  return { valid: true, value: trimmed };
}

export function mapSummaryResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('La respuesta de resumen está vacía.');
  }
  return {
    es_demo: Boolean(payload.es_demo),
    codigo: payload.codigo || '',
    nombre: payload.nombre || '',
    cantidad_bitacoras: Number(payload.cantidad_bitacoras ?? 0),
    bitacoras_leidas: Number(payload.bitacoras_leidas ?? 0),
    generado_en: payload.generado_en || new Date().toISOString(),
    modelo: payload.modelo || 'desconocido',
    aviso_revision: payload.aviso_revision || 'Resumen asistido por IA. Requiere revisión profesional.',
    estado_general: payload.estado_general || '',
    avances_recientes: Array.isArray(payload.avances_recientes) ? payload.avances_recientes : [],
    acciones_pendientes: Array.isArray(payload.acciones_pendientes) ? payload.acciones_pendientes : [],
    incertidumbres: Array.isArray(payload.incertidumbres) ? payload.incertidumbres : [],
    fuentes: Array.isArray(payload.fuentes) ? payload.fuentes : [],
  };
}

export function mapActivityRow(row) {
  return {
    id: row.id,
    descripcion: row.descripcion || '',
    fecha: row.fecha,
    persona_id: row.persona_id ?? null,
    bitacora_id: row.bitacora_id ?? null,
    actor_nombre: row.actor_nombre || 'Equipo CEMIPRE',
  };
}

function extractContextMessage(rawText, status) {
  const trimmed = (rawText || '').trim();
  if (trimmed) {
    try {
      const body = JSON.parse(trimmed);
      const detail = body?.error || body?.message || body?.msg;
      if (detail) return String(detail);
    } catch {
      const prefix = status ? `HTTP ${status}: ` : '';
      return `${prefix}${trimmed.slice(0, 220)}`;
    }
  }
  return status ? `Error del servidor (HTTP ${status}).` : null;
}

export async function formatApiError(err, fallback = 'Ocurrió un error al comunicarse con Supabase.') {
  if (!err) return fallback;
  if (err.context && typeof err.context.text === 'function') {
    try {
      const rawText = typeof err.context.clone === 'function'
        ? await err.context.clone().text()
        : await err.context.text();
      const parsed = extractContextMessage(rawText, err.context.status);
      if (parsed) return parsed;
    } catch {
      // Continuar al fallback si no se pudo leer el cuerpo
    }
  } else if (err.context && typeof err.context.json === 'function') {
    try {
      const body = await err.context.json();
      const detail = body?.error || body?.message || body?.msg;
      if (detail) return String(detail);
    } catch {
      // Continuar al mensaje general si no es JSON
    }
  }
  if (err.code === '23505') return 'Ya existe un registro con ese código o identificador.';
  if (err.code === '42501') return 'No tienes permisos suficientes para realizar esta acción.';
  return err.message || fallback;
}

function requireClient() {
  if (!supabase) {
    throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env.local.');
  }
  return supabase;
}

async function recordActivity(descripcion, { personaId = null, bitacoraId = null, actor = null } = {}) {
  const client = requireClient();
  const payload = {
    descripcion: descripcion.slice(0, 250),
    persona_id: personaId,
    bitacora_id: bitacoraId,
    actor_id: actor?.id ?? null,
    actor_nombre: actor?.nombre || actor?.email || 'Equipo CEMIPRE',
  };
  await client.from('actividad').insert(payload);
}

export const api = {
  // --- Auth y Perfiles ---
  async getSession() {
    const client = requireClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(await formatApiError(error));
    return data.session;
  },

  onAuthStateChange(callback) {
    const client = requireClient();
    return client.auth.onAuthStateChange(callback);
  },

  async signInWithPassword({ email, password }) {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(await formatApiError(error, 'Credenciales inválidas.'));
    return data;
  },

  async signUp({ email, password, nombre }) {
    const client = requireClient();
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: (nombre || '').trim(),
          nombre: (nombre || '').trim(),
        },
      },
    });
    if (error) throw new Error(await formatApiError(error, 'No se pudo registrar la cuenta.'));
    return data;
  },

  async signInWithGoogle() {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(await formatApiError(error, 'No se pudo iniciar con Google.'));
    return data;
  },

  async signOut() {
    const client = requireClient();
    const { error } = await client.auth.signOut();
    if (error) throw new Error(await formatApiError(error));
  },

  async getMyProfile(userId) {
    const client = requireClient();
    const { data, error } = await client
      .from('perfiles')
      .select('id, email, nombre, rol, recibir_notificaciones, creado')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async updateMyProfile(userId, { nombre, recibir_notificaciones }) {
    const client = requireClient();
    const checkName = validateTextLength(nombre, 120, 'El nombre');
    if (!checkName.valid) throw new Error(checkName.error);
    const { data, error } = await client
      .from('perfiles')
      .update({
        nombre: checkName.value,
        recibir_notificaciones: Boolean(recibir_notificaciones),
      })
      .eq('id', userId)
      .select('id, email, nombre, rol, recibir_notificaciones, creado')
      .single();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async listProfiles() {
    const client = requireClient();
    const { data, error } = await client
      .from('perfiles')
      .select('id, email, nombre, rol, recibir_notificaciones, creado')
      .order('creado', { ascending: false });
    if (error) throw new Error(await formatApiError(error));
    return data ?? [];
  },

  async updateProfileRole(profileId, rol) {
    const client = requireClient();
    const { data, error } = await client
      .from('perfiles')
      .update({ rol })
      .eq('id', profileId)
      .select('id, email, nombre, rol, recibir_notificaciones, creado')
      .single();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async listWhitelist() {
    const client = requireClient();
    const { data, error } = await client
      .from('emails_autorizados')
      .select('email, rol, agregado_en')
      .order('agregado_en', { ascending: false });
    if (error) throw new Error(await formatApiError(error));
    return data ?? [];
  },

  async addWhitelistEmail({ email, rol }) {
    const client = requireClient();
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Ingresa un correo válido.');
    }
    const { data, error } = await client
      .from('emails_autorizados')
      .upsert({ email: cleanEmail, rol })
      .select('email, rol, agregado_en')
      .single();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async removeWhitelistEmail(email) {
    const client = requireClient();
    const { error } = await client.from('emails_autorizados').delete().eq('email', email);
    if (error) throw new Error(await formatApiError(error));
  },

  // --- Estadísticas globales ---
  async getOverviewStats() {
    const client = requireClient();
    const [personasRes, bitacorasRes, vinculadasRes, eventosRes] = await Promise.all([
      client.from('personas').select('id', { count: 'exact', head: true }),
      client.from('bitacoras').select('id', { count: 'exact', head: true }),
      client.from('bitacoras').select('id', { count: 'exact', head: true }).neq('google_doc_id', ''),
      client.from('eventos').select('id', { count: 'exact', head: true }),
    ]);
    return {
      totalPersonas: personasRes.count ?? 0,
      totalBitacoras: bitacorasRes.count ?? 0,
      totalVinculadas: vinculadasRes.count ?? 0,
      totalEventos: eventosRes.count ?? 0,
    };
  },

  // --- Personas (CRUD + Paginación) ---
  async users({ page = 1, pageSize = 15, search = '', favoriteIds = null } = {}) {
    const client = requireClient();
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * pageSize;
    const to = from + pageSize - 1;

    if (Array.isArray(favoriteIds) && favoriteIds.length === 0) {
      return { personas: [], total: 0, page: 1, pageSize, totalPages: 1 };
    }

    let query = client
      .from('personas')
      .select('id, codigo, nombre, creado, drive_folder_id, bitacoras(count)', { count: 'exact' })
      .order('codigo', { ascending: true })
      .range(from, to);

    const term = search.trim();
    if (term) {
      const escaped = term.replace(/[,%()]/g, '');
      query = query.or(`codigo.ilike.%${escaped}%,nombre.ilike.%${escaped}%`);
    }
    if (Array.isArray(favoriteIds)) {
      query = query.in('id', favoriteIds);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(await formatApiError(error));

    const total = count ?? 0;
    const personas = (data ?? []).map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      creado: p.creado,
      drive_folder_id: p.drive_folder_id || '',
      total_bitacoras: p.bitacoras?.[0]?.count ?? 0,
    }));

    return {
      personas,
      total,
      page: safePage,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async user(id) {
    const client = requireClient();
    const { data, error } = await client
      .from('personas')
      .select('id, codigo, nombre, creado, drive_folder_id, bitacoras(id, persona_id, titulo, url_docs, google_doc_id, orden, actualizada, drive_modified_time, estado_sync)')
      .eq('id', id)
      .order('orden', { referencedTable: 'bitacoras', ascending: true })
      .order('id', { referencedTable: 'bitacoras', ascending: true })
      .single();
    if (error) throw new Error(await formatApiError(error, 'No se pudo cargar el usuario.'));
    return data;
  },

  async createUser({ codigo, nombre, drive_folder_id = '' }, actor) {
    const client = requireClient();
    const checkCodigo = validateTextLength(codigo, 32, 'El código');
    if (!checkCodigo.valid) throw new Error(checkCodigo.error);
    const checkNombre = validateTextLength(nombre, 120, 'El nombre');
    if (!checkNombre.valid) throw new Error(checkNombre.error);

    const { data, error } = await client
      .from('personas')
      .insert({
        codigo: checkCodigo.value.toUpperCase(),
        nombre: checkNombre.value,
        drive_folder_id: (drive_folder_id || '').trim(),
      })
      .select('id, codigo, nombre, drive_folder_id')
      .single();
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se creó el registro ${data.codigo} (${data.nombre}).`, {
      personaId: data.id,
      actor,
    });
    return data;
  },

  async updateUser(id, { codigo, nombre, drive_folder_id = '' }, actor) {
    const client = requireClient();
    const checkCodigo = validateTextLength(codigo, 32, 'El código');
    if (!checkCodigo.valid) throw new Error(checkCodigo.error);
    const checkNombre = validateTextLength(nombre, 120, 'El nombre');
    if (!checkNombre.valid) throw new Error(checkNombre.error);

    const { data, error } = await client
      .from('personas')
      .update({
        codigo: checkCodigo.value.toUpperCase(),
        nombre: checkNombre.value,
        drive_folder_id: (drive_folder_id || '').trim(),
      })
      .eq('id', id)
      .select('id, codigo, nombre, drive_folder_id')
      .single();
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se actualizaron los datos de ${data.codigo}.`, {
      personaId: data.id,
      actor,
    });
    return data;
  },

  async deleteUser(id, personaCodigo, actor) {
    const client = requireClient();
    const { error } = await client.from('personas').delete().eq('id', id);
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se eliminó el usuario ${personaCodigo}.`, { actor });
  },

  // --- Bitácoras (CRUD + Paginación) ---
  async listAllLogs({ page = 1, pageSize = 20, search = '', statusFilter = 'all' } = {}) {
    const client = requireClient();
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = client
      .from('bitacoras')
      .select(
        'id, persona_id, titulo, url_docs, google_doc_id, actualizada, drive_modified_time, estado_sync, personas(id, codigo, nombre)',
        { count: 'exact' },
      )
      .order('actualizada', { ascending: false })
      .range(from, to);

    const term = search.trim();
    if (term) {
      const escaped = term.replace(/[,%()]/g, '');
      query = query.ilike('titulo', `%${escaped}%`);
    }
    if (statusFilter === 'linked') {
      query = query.neq('google_doc_id', '');
    } else if (statusFilter === 'unlinked') {
      query = query.eq('google_doc_id', '');
    } else if (statusFilter === 'errors') {
      query = query.in('estado_sync', ['sin_permiso', 'no_encontrada']);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(await formatApiError(error));
    const total = count ?? 0;
    return {
      bitacoras: data ?? [],
      total,
      page: safePage,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async createLog({ persona_id, titulo, url_docs = '' }, actor) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre de la bitácora');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkLink = validateDocsLink(url_docs);
    if (!checkLink.valid) throw new Error(checkLink.error);

    const { count } = await client
      .from('bitacoras')
      .select('id', { count: 'exact', head: true })
      .eq('persona_id', persona_id);

    const { data, error } = await client
      .from('bitacoras')
      .insert({
        persona_id,
        titulo: checkTitulo.value,
        url_docs: checkLink.normalizedUrl || '',
        google_doc_id: checkLink.googleDocId,
        estado_sync: checkLink.googleDocId ? 'pendiente' : 'sin_enlace',
        orden: count ?? 0,
      })
      .select('id, persona_id, titulo, url_docs, google_doc_id, actualizada, estado_sync')
      .single();

    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se agregó la bitácora "${data.titulo}".`, {
      personaId: persona_id,
      bitacoraId: data.id,
      actor,
    });
    return data;
  },

  async updateLog(id, { titulo, url_docs = '' }, actor) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre de la bitácora');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkLink = validateDocsLink(url_docs);
    if (!checkLink.valid) throw new Error(checkLink.error);

    const { data, error } = await client
      .from('bitacoras')
      .update({
        titulo: checkTitulo.value,
        url_docs: checkLink.normalizedUrl || '',
        google_doc_id: checkLink.googleDocId,
        estado_sync: checkLink.googleDocId ? 'pendiente' : 'sin_enlace',
      })
      .eq('id', id)
      .select('id, persona_id, titulo, url_docs, google_doc_id, actualizada, estado_sync')
      .single();

    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se actualizaron datos de la bitácora "${data.titulo}".`, {
      personaId: data.persona_id,
      bitacoraId: data.id,
      actor,
    });
    return data;
  },

  async deleteLog(log, actor) {
    const client = requireClient();
    const { error } = await client.from('bitacoras').delete().eq('id', log.id);
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se eliminó la ficha "${log.titulo}".`, {
      personaId: log.persona_id,
      actor,
    });
  },

  // --- Eventos / Calendario (CRUD completo) ---
  async events() {
    const client = requireClient();
    const { data, error } = await client
      .from('eventos')
      .select('id, titulo, descripcion, inicio, fin, responsable, creado')
      .order('inicio', { ascending: true });
    if (error) throw new Error(await formatApiError(error));
    return { eventos: data ?? [] };
  },

  async createEvent({ titulo, descripcion = '', inicio, fin, responsable = 'Equipo CEMIPRE' }, actor) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre del evento');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkOwner = validateTextLength(responsable || 'Equipo CEMIPRE', 120, 'El responsable');
    if (!checkOwner.valid) throw new Error(checkOwner.error);
    const checkDates = validateEventDates(inicio, fin);
    if (!checkDates.valid) throw new Error(checkDates.error);
    if (typeof descripcion !== 'string' || descripcion.length > 2000) {
      throw new Error('La descripción no debe superar 2000 caracteres.');
    }

    const { data, error } = await client
      .from('eventos')
      .insert({
        titulo: checkTitulo.value,
        descripcion: descripcion.trim(),
        inicio: checkDates.startIso,
        fin: checkDates.endIso,
        responsable: checkOwner.value,
      })
      .select('id, titulo, descripcion, inicio, fin, responsable')
      .single();
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se creó el evento "${data.titulo}".`, { actor });
    return data;
  },

  async updateEvent(id, { titulo, descripcion = '', inicio, fin, responsable = 'Equipo CEMIPRE' }, actor) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre del evento');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkOwner = validateTextLength(responsable || 'Equipo CEMIPRE', 120, 'El responsable');
    if (!checkOwner.valid) throw new Error(checkOwner.error);
    const checkDates = validateEventDates(inicio, fin);
    if (!checkDates.valid) throw new Error(checkDates.error);
    if (typeof descripcion !== 'string' || descripcion.length > 2000) {
      throw new Error('La descripción no debe superar 2000 caracteres.');
    }

    const { data, error } = await client
      .from('eventos')
      .update({
        titulo: checkTitulo.value,
        descripcion: descripcion.trim(),
        inicio: checkDates.startIso,
        fin: checkDates.endIso,
        responsable: checkOwner.value,
      })
      .eq('id', id)
      .select('id, titulo, descripcion, inicio, fin, responsable')
      .single();
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se actualizó el evento "${data.titulo}".`, { actor });
    return data;
  },

  async deleteEvent(id, titulo, actor) {
    const client = requireClient();
    const { error } = await client.from('eventos').delete().eq('id', id);
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se eliminó el evento "${titulo || id}".`, { actor });
  },

  // --- Actividad (Paginada) ---
  async activity({ page = 1, pageSize = 20 } = {}) {
    const client = requireClient();
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await client
      .from('actividad')
      .select('id, descripcion, fecha, persona_id, bitacora_id, actor_nombre', { count: 'exact' })
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) throw new Error(await formatApiError(error));
    const total = count ?? 0;
    return {
      actividad: (data ?? []).map(mapActivityRow),
      total,
      page: safePage,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  // --- Favoritos por trabajador (Supabase) ---
  async listFavorites() {
    const client = requireClient();
    const { data, error } = await client
      .from('favoritos_trabajador')
      .select('id, persona_id, creado, personas(id, codigo, nombre, drive_folder_id)')
      .order('creado', { ascending: false });
    if (error) throw new Error(await formatApiError(error));
    return data ?? [];
  },

  async toggleFavorite(personaId, currentlyFavorite) {
    const client = requireClient();
    if (currentlyFavorite) {
      const { error } = await client
        .from('favoritos_trabajador')
        .delete()
        .eq('persona_id', personaId);
      if (error) throw new Error(await formatApiError(error));
      return false;
    }
    const { error } = await client
      .from('favoritos_trabajador')
      .insert({ persona_id: personaId });
    if (error) throw new Error(await formatApiError(error));
    return true;
  },

  // --- Comentarios internos por persona ---
  async listComments(personaId) {
    const client = requireClient();
    const { data, error } = await client
      .from('comentarios_internos')
      .select('id, persona_id, bitacora_id, autor_id, autor_nombre, contenido, creado')
      .eq('persona_id', personaId)
      .order('creado', { ascending: false });
    if (error) throw new Error(await formatApiError(error));
    return data ?? [];
  },

  async createComment({ persona_id, bitacora_id = null, contenido }, actor) {
    const client = requireClient();
    const check = validateTextLength(contenido, 1500, 'El comentario');
    if (!check.valid) throw new Error(check.error);
    const { data, error } = await client
      .from('comentarios_internos')
      .insert({
        persona_id,
        bitacora_id,
        autor_id: actor.id,
        autor_nombre: actor.nombre || actor.email,
        contenido: check.value,
      })
      .select('id, persona_id, bitacora_id, autor_id, autor_nombre, contenido, creado')
      .single();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async deleteComment(commentId) {
    const client = requireClient();
    const { error } = await client.from('comentarios_internos').delete().eq('id', commentId);
    if (error) throw new Error(await formatApiError(error));
  },

  // --- Edge Functions & Sincronización Drive & Avisos ---
  async summary(personaId) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('resumen-usuario', {
      body: { persona_id: personaId },
    });
    if (error) throw new Error(await formatApiError(error, 'No se pudo generar el resumen IA.'));
    return mapSummaryResponse(data);
  },

  async syncDrive(payload = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-drive', {
      body: payload,
    });
    if (error) throw new Error(await formatApiError(error, 'Error al sincronizar con Google Drive.'));
    return data;
  },

  async getDriveSyncState() {
    const client = requireClient();
    const { data, error } = await client
      .from('drive_sync_state')
      .select('id, start_page_token, ultima_sincronizacion, ultimo_estado, actualizado')
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  async listNotifications({ page = 1, pageSize = 20 } = {}) {
    const client = requireClient();
    const safePage = Math.max(1, page);
    const from = (safePage - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await client
      .from('notificaciones_enviadas')
      .select(
        'id, bitacora_id, persona_id, destinatario_email, estado, detalle_error, enviada_en, bitacoras(titulo), personas(codigo, nombre)',
        { count: 'exact' },
      )
      .order('enviada_en', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(await formatApiError(error));
    const total = count ?? 0;
    return {
      notificaciones: data ?? [],
      total,
      page: safePage,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },
};
