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

export const GOOGLE_CALENDAR_OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_DRIVE_OAUTH_SCOPES = `https://www.googleapis.com/auth/drive ${GOOGLE_CALENDAR_OAUTH_SCOPE}`;

export function hasGoogleCalendarScope(driveStatus) {
  if (!driveStatus) return false;
  if (driveStatus.tiene_calendar_scope) return true;
  if (driveStatus.conectado && String(driveStatus.scopes || '').toLowerCase().includes('calendar')) {
    return true;
  }
  if (driveStatus.institucional?.tiene_calendar_scope) return true;
  return false;
}

export function buildGoogleOAuthOptions({ withDrive = true, redirectTo = '' } = {}) {
  const options = {
    redirectTo: redirectTo || (typeof window !== 'undefined' ? window.location.origin : ''),
  };
  if (withDrive) {
    options.scopes = GOOGLE_DRIVE_OAUTH_SCOPES;
    options.queryParams = {
      access_type: 'offline',
      prompt: 'select_account',
    };
  }
  return options;
}

export function isDriveSyncStale(syncState, maxAgeMinutes = 4) {
  if (!syncState || syncState.auto_sync_enabled === false) return false;
  if (syncState.sync_en_curso) return false;
  if (!syncState.ultima_sincronizacion) return true;
  const lastMs = new Date(syncState.ultima_sincronizacion).getTime();
  if (Number.isNaN(lastMs)) return true;
  const intervalMin = Math.max(2, Number(syncState.auto_sync_interval_min || maxAgeMinutes));
  return Date.now() - lastMs >= intervalMin * 60_000;
}

const DOC_PATH_REGEX = /^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/;

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

const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;
const DRIVE_FOLDER_PATH_REGEX = /\/folders\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/;

/**
 * Extrae el ID limpio de una carpeta de Google Drive aceptando URL completa,
 * ruta parcial (`folders/<ID>?usp=sharing`), ID con parámetros o ID directo.
 */
export function extractGoogleFolderId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;

  if (trimmed.includes('://')) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== 'drive.google.com'
      || parsed.username !== ''
      || parsed.password !== ''
    ) {
      return null;
    }
    const pathMatch = parsed.pathname.match(DRIVE_FOLDER_PATH_REGEX);
    if (pathMatch) return pathMatch[1];
    if (parsed.pathname === '/open') {
      const openId = (parsed.searchParams.get('id') || '').trim();
      return DRIVE_ID_REGEX.test(openId) ? openId : null;
    }
    return null;
  }

  const clean = trimmed
    .replace(/^(?:\/?drive\/(?:u\/\d+\/)?)?\/?folders\//i, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')
    .trim();
  return DRIVE_ID_REGEX.test(clean) ? clean : null;
}

/**
 * Valida y normaliza un ID o enlace de carpeta en Google Drive (opcional).
 */
export function validateDriveFolderInput(value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, folderId: '' };
  }
  if (typeof value !== 'string') {
    return { valid: false, folderId: '', error: 'El identificador de carpeta debe ser texto.' };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true, folderId: '' };
  }
  if (trimmed.length > 500) {
    return { valid: false, folderId: '', error: 'El enlace de carpeta supera los 500 caracteres permitidos.' };
  }
  const folderId = extractGoogleFolderId(trimmed);
  if (!folderId) {
    return {
      valid: false,
      folderId: '',
      error: 'Ingresa un ID de carpeta válido o un enlace https://drive.google.com/drive/folders/<ID>.',
    };
  }
  return { valid: true, folderId };
}

/**
 * Extrae el ID limpio de un enlace de Google Drive (carpeta de usuario) o Google Docs.
 */
export function extractDriveResourceInfo(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: true, kind: null, id: '', label: '' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    return {
      valid: false,
      kind: null,
      id: '',
      label: '',
      error: 'El enlace supera los 500 caracteres permitidos.',
    };
  }

  const docId = extractGoogleDocId(trimmed);
  if (docId) {
    return {
      valid: true,
      kind: 'doc',
      id: docId,
      label: 'Documento Google Docs',
    };
  }

  const folderId = extractGoogleFolderId(trimmed);
  if (folderId) {
    const looksLikeFolderLink = trimmed.includes('://') || /folders\//i.test(trimmed) || /[?#]/.test(trimmed);
    return {
      valid: true,
      kind: looksLikeFolderLink ? 'folder' : 'id',
      id: folderId,
      label: looksLikeFolderLink ? 'Carpeta de usuario (Drive)' : 'ID válido de Google Drive',
    };
  }

  return {
    valid: false,
    kind: null,
    id: '',
    label: '',
    error: 'Enlace o ID no reconocido. Pega https://drive.google.com/drive/folders/... o https://docs.google.com/document/d/...',
  };
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

export async function formatApiError(err, fallback = 'Ocurrió un error al comunicarse con el servidor.') {
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

  async signInWithGoogle({ withDrive = true } = {}) {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: buildGoogleOAuthOptions({ withDrive }),
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

  async canManageAdmins() {
    const client = requireClient();
    const { data, error } = await client.rpc('es_superadmin_actual');
    if (error) return false;
    return Boolean(data);
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
      .select('id, codigo, nombre, creado, drive_folder_id, drive_folder_name, bitacoras(count)', { count: 'exact' })
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
      drive_folder_name: p.drive_folder_name || '',
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
      .select('id, codigo, nombre, creado, drive_folder_id, drive_folder_name, bitacoras(id, persona_id, titulo, url_docs, google_doc_id, orden, actualizada, drive_modified_time, estado_sync)')
      .eq('id', id)
      .order('orden', { referencedTable: 'bitacoras', ascending: true })
      .order('id', { referencedTable: 'bitacoras', ascending: true })
      .single();
    if (error) throw new Error(await formatApiError(error, 'No se pudo cargar el usuario.'));
    return data;
  },

  async createUser({ codigo, nombre, drive_folder_id = '', drive_folder_name = '' }, actor) {
    const client = requireClient();
    const checkCodigo = validateTextLength(codigo, 32, 'El código');
    if (!checkCodigo.valid) throw new Error(checkCodigo.error);
    const checkNombre = validateTextLength(nombre, 120, 'El nombre');
    if (!checkNombre.valid) throw new Error(checkNombre.error);
    const checkFolder = validateDriveFolderInput(drive_folder_id);
    if (!checkFolder.valid) throw new Error(checkFolder.error);

    const cleanFolderName = checkFolder.folderId
      ? String(drive_folder_name || '').trim().slice(0, 160)
      : '';

    const { data, error } = await client
      .from('personas')
      .insert({
        codigo: checkCodigo.value.toUpperCase(),
        nombre: checkNombre.value,
        drive_folder_id: checkFolder.folderId,
        drive_folder_name: cleanFolderName,
        linked_by_user_id: checkFolder.folderId ? (actor?.id ?? null) : null,
      })
      .select('id, codigo, nombre, drive_folder_id, drive_folder_name')
      .single();
    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se creó el registro ${data.codigo} (${data.nombre}).`, {
      personaId: data.id,
      actor,
    });
    return data;
  },

  async updateUser(id, { codigo, nombre, drive_folder_id = '', drive_folder_name = '' }, actor) {
    const client = requireClient();
    const checkCodigo = validateTextLength(codigo, 32, 'El código');
    if (!checkCodigo.valid) throw new Error(checkCodigo.error);
    const checkNombre = validateTextLength(nombre, 120, 'El nombre');
    if (!checkNombre.valid) throw new Error(checkNombre.error);
    const checkFolder = validateDriveFolderInput(drive_folder_id);
    if (!checkFolder.valid) throw new Error(checkFolder.error);

    const cleanFolderName = checkFolder.folderId
      ? String(drive_folder_name || '').trim().slice(0, 160)
      : '';

    const { data, error } = await client
      .from('personas')
      .update({
        codigo: checkCodigo.value.toUpperCase(),
        nombre: checkNombre.value,
        drive_folder_id: checkFolder.folderId,
        drive_folder_name: cleanFolderName,
        ...(checkFolder.folderId && actor?.id ? { linked_by_user_id: actor.id } : {}),
      })
      .eq('id', id)
      .select('id, codigo, nombre, drive_folder_id, drive_folder_name')
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
        linked_by_user_id: checkLink.googleDocId ? (actor?.id ?? null) : null,
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

  async createLogsFromDrive({ persona_id, docs }, actor) {
    const client = requireClient();
    if (!Array.isArray(docs) || docs.length === 0) {
      throw new Error('Selecciona al menos un Google Doc desde Drive.');
    }

    const { data: existingRows, error: exErr } = await client
      .from('bitacoras')
      .select('id, google_doc_id, orden')
      .eq('persona_id', persona_id);
    if (exErr) throw new Error(await formatApiError(exErr));

    const existing = existingRows ?? [];
    const existingIds = new Set(existing.map((b) => (b.google_doc_id || '').trim()).filter(Boolean));
    let nextOrder = existing.reduce((max, b) => Math.max(max, (b.orden ?? 0) + 1), 0);

    const rowsToInsert = [];
    let skipped = 0;
    for (const doc of docs) {
      const docId = String(doc.id || '').trim();
      if (!docId || existingIds.has(docId)) {
        skipped++;
        continue;
      }
      existingIds.add(docId);
      const rawUrl = doc.url || `https://docs.google.com/document/d/${docId}/edit`;
      const checkLink = validateDocsLink(rawUrl);
      const title = String(doc.name || 'Bitácora Drive').trim().slice(0, 160) || 'Bitácora Drive';
      rowsToInsert.push({
        persona_id,
        titulo: title,
        url_docs: checkLink.valid && checkLink.normalizedUrl ? checkLink.normalizedUrl : `https://docs.google.com/document/d/${docId}/edit`,
        google_doc_id: docId,
        drive_modified_time: doc.modified_time || null,
        drive_revision_id: doc.head_revision_id || '',
        estado_sync: 'sincronizada',
        orden: nextOrder++,
        linked_by_user_id: actor?.id ?? null,
      });
    }

    if (rowsToInsert.length === 0) {
      return { inserted: [], skipped };
    }

    const { data, error } = await client
      .from('bitacoras')
      .insert(rowsToInsert)
      .select('id, persona_id, titulo, url_docs, google_doc_id, actualizada, drive_modified_time, estado_sync');
    if (error) throw new Error(await formatApiError(error));

    const inserted = data ?? [];
    const summaryLabel = inserted.length === 1
      ? `Se vinculó desde Google Drive la bitácora "${inserted[0].titulo}".`
      : `Se vincularon ${inserted.length} bitácoras directamente desde Google Drive.`;
    await recordActivity(summaryLabel, {
      personaId: persona_id,
      bitacoraId: inserted[0]?.id ?? null,
      actor,
    });

    return { inserted, skipped };
  },

  async createLogWithDrive({ persona_id, titulo }) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre de la bitácora');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const { data, error } = await client.functions.invoke('crear-bitacora-drive', {
      body: {
        persona_id,
        titulo: checkTitulo.value,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo crear la carpeta y el Google Doc en Drive.'));
    }
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
        ...(checkLink.googleDocId && actor?.id ? { linked_by_user_id: actor.id } : {}),
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

  // --- Eventos / Calendario (CRUD completo + etiquetas + Google Calendar) ---
  async events() {
    const client = requireClient();
    const { data, error } = await client
      .from('eventos')
      .select(
        'id, titulo, descripcion, inicio, fin, responsable, creado, etiqueta, color, todo_el_dia, origen, google_event_id, google_calendar_id, google_calendar_name, google_html_link',
      )
      .order('inicio', { ascending: true });
    if (error) {
      const missingCol = error.code === '42703'
        || error.code === 'PGRST204'
        || /column .* does not exist|Could not find .* column/i.test(error.message || '');
      if (missingCol) {
        const legacy = await client
          .from('eventos')
          .select('id, titulo, descripcion, inicio, fin, responsable, creado')
          .order('inicio', { ascending: true });
        if (legacy.error) throw new Error(await formatApiError(legacy.error));
        return { eventos: legacy.data ?? [] };
      }
      throw new Error(await formatApiError(error));
    }
    return { eventos: data ?? [] };
  },

  async createEvent(
    {
      titulo,
      descripcion = '',
      inicio,
      fin,
      responsable = 'Equipo CEMIPRE',
      etiqueta = 'General',
      color = '',
    },
    actor,
  ) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre del evento');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkOwner = validateTextLength(responsable || 'Equipo CEMIPRE', 120, 'El responsable');
    if (!checkOwner.valid) throw new Error(checkOwner.error);
    const checkLabel = validateTextLength(etiqueta || 'General', 60, 'La etiqueta');
    if (!checkLabel.valid) throw new Error(checkLabel.error);
    const checkDates = validateEventDates(inicio, fin);
    if (!checkDates.valid) throw new Error(checkDates.error);
    if (typeof descripcion !== 'string' || descripcion.length > 2000) {
      throw new Error('La descripción no debe superar 2000 caracteres.');
    }
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())
      ? String(color).trim().toLowerCase()
      : '';

    const basePayload = {
      titulo: checkTitulo.value,
      descripcion: descripcion.trim(),
      inicio: checkDates.startIso,
      fin: checkDates.endIso,
      responsable: checkOwner.value,
    };

    let { data, error } = await client
      .from('eventos')
      .insert({
        ...basePayload,
        etiqueta: checkLabel.value,
        color: cleanColor,
        origen: 'cemipre',
      })
      .select(
        'id, titulo, descripcion, inicio, fin, responsable, etiqueta, color, todo_el_dia, origen, google_event_id, google_calendar_id, google_calendar_name, google_html_link',
      )
      .single();

    if (
      error
      && (error.code === '42703'
        || error.code === 'PGRST204'
        || /column .* does not exist|Could not find .* column/i.test(error.message || ''))
    ) {
      const legacy = await client
        .from('eventos')
        .insert(basePayload)
        .select('id, titulo, descripcion, inicio, fin, responsable')
        .single();
      data = legacy.data;
      error = legacy.error;
    }

    if (error) throw new Error(await formatApiError(error));
    await recordActivity(`Se creó el evento "${data.titulo}".`, { actor });
    return data;
  },

  async updateEvent(
    id,
    {
      titulo,
      descripcion = '',
      inicio,
      fin,
      responsable = 'Equipo CEMIPRE',
      etiqueta = 'General',
      color = '',
    },
    actor,
  ) {
    const client = requireClient();
    const checkTitulo = validateTextLength(titulo, 160, 'El nombre del evento');
    if (!checkTitulo.valid) throw new Error(checkTitulo.error);
    const checkOwner = validateTextLength(responsable || 'Equipo CEMIPRE', 120, 'El responsable');
    if (!checkOwner.valid) throw new Error(checkOwner.error);
    const checkLabel = validateTextLength(etiqueta || 'General', 60, 'La etiqueta');
    if (!checkLabel.valid) throw new Error(checkLabel.error);
    const checkDates = validateEventDates(inicio, fin);
    if (!checkDates.valid) throw new Error(checkDates.error);
    if (typeof descripcion !== 'string' || descripcion.length > 2000) {
      throw new Error('La descripción no debe superar 2000 caracteres.');
    }
    const cleanColor = /^#[0-9a-fA-F]{6}$/.test(String(color || '').trim())
      ? String(color).trim().toLowerCase()
      : '';

    const basePayload = {
      titulo: checkTitulo.value,
      descripcion: descripcion.trim(),
      inicio: checkDates.startIso,
      fin: checkDates.endIso,
      responsable: checkOwner.value,
    };

    let { data, error } = await client
      .from('eventos')
      .update({
        ...basePayload,
        etiqueta: checkLabel.value,
        color: cleanColor,
      })
      .eq('id', id)
      .select(
        'id, titulo, descripcion, inicio, fin, responsable, etiqueta, color, todo_el_dia, origen, google_event_id, google_calendar_id, google_calendar_name, google_html_link',
      )
      .single();

    if (
      error
      && (error.code === '42703'
        || error.code === 'PGRST204'
        || /column .* does not exist|Could not find .* column/i.test(error.message || ''))
    ) {
      const legacy = await client
        .from('eventos')
        .update(basePayload)
        .eq('id', id)
        .select('id, titulo, descripcion, inicio, fin, responsable')
        .single();
      data = legacy.data;
      error = legacy.error;
    }

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

  async startGoogleCalendarOAuth({ set_institutional = false } = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: {
        action: 'start-oauth',
        purpose: 'calendar',
        set_institutional: Boolean(set_institutional),
        return_to: window.location.origin,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo iniciar la autorización con Google Calendar.'));
    }
    if (!data?.auth_url) {
      throw new Error('El servidor no devolvió la URL de autorización de Google.');
    }
    window.location.assign(data.auth_url);
    return data;
  },

  async getGoogleCalendarSyncState() {
    const client = requireClient();
    const { data, error } = await client
      .from('google_calendar_sync_state')
      .select('id, calendars, sync_direction, target_calendar_id, target_calendar_name, auto_sync_enabled, sync_en_curso, ultima_sincronizacion, ultimo_estado, actualizado')
      .eq('id', 'global')
      .maybeSingle();
    if (error) {
      if (
        error.code === '42P01'
        || error.code === 'PGRST205'
        || /relation .* does not exist|Could not find the table/i.test(error.message || '')
      ) {
        return null;
      }
      throw new Error(await formatApiError(error));
    }
    return data;
  },

  async listGoogleCalendars() {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-google-calendar', {
      body: { action: 'list-calendars' },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo cargar tu lista de Google Calendar.'));
    }
    return data;
  },

  async saveGoogleCalendarConfig({
    calendars = [],
    sync_direction = 'bidirectional',
    target_calendar_id = 'primary',
    target_calendar_name = 'Principal',
  } = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-google-calendar', {
      body: {
        action: 'save-config',
        calendars,
        sync_direction,
        target_calendar_id,
        target_calendar_name,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo guardar la configuración de Google Calendar.'));
    }
    return data;
  },

  async syncGoogleCalendar({ push_local = true } = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-google-calendar', {
      body: {
        action: 'sync',
        push_local: Boolean(push_local),
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo sincronizar con Google Calendar.'));
    }
    return data;
  },

  async pushEventToGoogleCalendar(eventoId) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-google-calendar', {
      body: {
        action: 'push-event',
        evento_id: eventoId,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo sincronizar el evento con Google Calendar.'));
    }
    return data;
  },

  async deleteEventFromGoogleCalendar({ google_event_id, google_calendar_id }) {
    if (!google_event_id || !google_calendar_id) return { ok: true, skipped: true };
    const client = requireClient();
    const { data, error } = await client.functions.invoke('sync-google-calendar', {
      body: {
        action: 'delete-event',
        google_event_id,
        google_calendar_id,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo eliminar el evento en Google Calendar.'));
    }
    return data;
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
    const nextPayload = { ...payload };
    if (nextPayload.root_folder_id) {
      const checkFolder = validateDriveFolderInput(nextPayload.root_folder_id);
      if (!checkFolder.valid) throw new Error(checkFolder.error);
      nextPayload.root_folder_id = checkFolder.folderId;
    }
    const { data, error } = await client.functions.invoke('sync-drive', {
      body: nextPayload,
    });
    if (error) throw new Error(await formatApiError(error, 'Error al sincronizar con Google Drive.'));
    return data;
  },

  async getDriveSyncState() {
    const client = requireClient();
    const { data, error } = await client
      .from('drive_sync_state')
      .select(
        'id, start_page_token, ultima_sincronizacion, ultimo_estado, actualizado, root_folder_id, root_folder_name, auto_sync_enabled, auto_sync_interval_min, sync_en_curso, auth_mode, institutional_email, connection_status',
      )
      .eq('id', 'global')
      .maybeSingle();
    if (error) throw new Error(await formatApiError(error));
    return data;
  },

  subscribeDriveSyncState(onUpdate) {
    if (!supabase || typeof supabase.channel !== 'function') return () => {};
    const channel = supabase
      .channel('cemipre-drive-sync-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drive_sync_state', filter: 'id=eq.global' },
        (payload) => {
          if (payload?.new) onUpdate(payload.new);
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // noop
      }
    };
  },

  async getGoogleDriveStatus() {
    const client = requireClient();
    const { data, error } = await client.rpc('mi_estado_google_drive');
    if (error) {
      return {
        conectado: false,
        google_email: '',
        status: 'desconectado',
        es_institucional: false,
        tiene_refresh_token: false,
        last_error: '',
        institucional: { conectado: false, google_email: '', status: 'sin_configurar', es_propia: false },
      };
    }
    return data ?? {
      conectado: false,
      google_email: '',
      status: 'desconectado',
      es_institucional: false,
      tiene_refresh_token: false,
      last_error: '',
      institucional: { conectado: false, google_email: '', status: 'sin_configurar', es_propia: false },
    };
  },

  async saveGoogleDriveSession({ provider_token, provider_refresh_token = '' }) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: {
        action: 'save-provider-tokens',
        provider_token,
        provider_refresh_token,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo vincular tu sesión de Google Drive.'));
    }
    return data;
  },

  async startGoogleDriveOAuth({ set_institutional = false } = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: {
        action: 'start-oauth',
        set_institutional: Boolean(set_institutional),
        return_to: window.location.origin,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo iniciar la autorización con Google Drive.'));
    }
    if (!data?.auth_url) {
      throw new Error('El servidor no devolvió la URL de autorización de Google.');
    }
    window.location.assign(data.auth_url);
    return data;
  },

  async setInstitutionalDriveConnection() {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: { action: 'set-institutional' },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo designar la cuenta institucional de Drive.'));
    }
    return data;
  },

  async setDriveRootFolder({ root_folder_id = '', root_folder_name = '' }) {
    const client = requireClient();
    const checkFolder = validateDriveFolderInput(root_folder_id);
    if (!checkFolder.valid) throw new Error(checkFolder.error);
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: {
        action: 'set-root-folder',
        root_folder_id: checkFolder.folderId,
        root_folder_name: String(root_folder_name || '').trim().slice(0, 160),
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo guardar la carpeta raíz de Google Drive.'));
    }
    return data;
  },

  async setDriveAutoSync({ enabled, interval_min = 5 }) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: {
        action: 'set-auto-sync',
        enabled: Boolean(enabled),
        interval_min,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo actualizar la configuración automática.'));
    }
    return data;
  },

  async disconnectGoogleDrive() {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('google-drive-auth', {
      body: { action: 'disconnect' },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo desconectar Google Drive.'));
    }
    return data;
  },

  async browseDrive({
    section = 'my_drive',
    folder_id = '',
    drive_id = '',
    query = '',
    mode = 'all',
    page_token = '',
  } = {}) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('drive-browser', {
      body: {
        section,
        folder_id,
        drive_id,
        query,
        mode,
        page_token,
      },
    });
    if (error) {
      throw new Error(await formatApiError(error, 'No se pudo explorar tu Google Drive.'));
    }
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
