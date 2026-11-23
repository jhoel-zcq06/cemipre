import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { timingSafeEqual } from '../_shared/crypto.ts';
import {
  type DriveFileMeta,
  getFileMetadata,
  getStartPageToken,
  getUserDriveToken,
  GoogleApiError,
  listFolderChildren,
  normalizeDocUrl,
  normalizeFolderId,
  parseFolderIdentity,
  type ResolvedDriveToken,
  resolveDriveTokenCandidates,
  withDriveTokenFallback,
} from '../_shared/google.ts';
import { AuthError, getSupabaseAdmin, requireAuthorizedWorker } from '../_shared/supabase.ts';

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_SHORTCUT = 'application/vnd.google-apps.shortcut';

const MAX_SUBFOLDER_DEPTH = 15;
const MAX_FOLDERS_PER_PERSONA = 300;
const SUBFOLDER_CONCURRENCY = 4;
const PERSONA_CONCURRENCY = 3;

interface SyncRequestBody {
  persona_id?: number;
  root_folder_id?: string;
  sync_titles?: boolean;
  crear_faltantes?: boolean;
  auto?: boolean;
  force?: boolean;
  origen?: string;
  cooldown_seconds?: number;
}

interface PersonaRow {
  id: number;
  codigo: string;
  nombre: string;
  drive_folder_id: string;
  drive_folder_name?: string;
  linked_by_user_id?: string | null;
}

interface BitacoraRow {
  id: number;
  persona_id: number;
  titulo: string;
  url_docs: string;
  google_doc_id: string;
  orden: number;
  drive_modified_time: string | null;
  drive_revision_id: string;
  estado_sync: string;
  linked_by_user_id?: string | null;
  drive_folder_path?: string;
}

interface ResolvedDocTarget {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  headRevisionId?: string;
  isShortcut: boolean;
}

interface CollectedDriveDoc extends ResolvedDocTarget {
  folderPath: string;
}

interface FolderTraversalResult {
  docs: CollectedDriveDoc[];
  foldersVisited: number;
  permissionErrors: Array<{ folderName: string; path: string }>;
  truncatedByLimit: boolean;
}

function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42703'
    || err.code === 'PGRST204'
    || /column .* does not exist|Could not find .* column/i.test(err.message || '');
}

function isGenericBitacoraName(name?: string): boolean {
  const normalized = (name || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return normalized === 'bitacora';
}

function formatFolderPath(pathSegments: string[], rootFolderName: string): string {
  if (pathSegments.length > 0) {
    return pathSegments.join(' / ').slice(0, 300);
  }
  const cleanRoot = (rootFolderName || '').trim();
  return (cleanRoot || 'Carpeta principal').slice(0, 300);
}

function resolveDocTarget(item: DriveFileMeta): ResolvedDocTarget | null {
  if (item.mimeType === MIME_DOC) {
    return {
      id: item.id,
      name: item.name,
      webViewLink: item.webViewLink,
      modifiedTime: item.modifiedTime,
      headRevisionId: item.headRevisionId,
      isShortcut: false,
    };
  }
  if (
    item.mimeType === MIME_SHORTCUT
    && item.shortcutDetails?.targetMimeType === MIME_DOC
    && item.shortcutDetails?.targetId
  ) {
    return {
      id: item.shortcutDetails.targetId,
      name: item.name,
      isShortcut: true,
    };
  }
  return null;
}

function resolveFolderTarget(
  item: DriveFileMeta,
): { id: string; name: string } | null {
  if (item.mimeType === MIME_FOLDER) {
    return { id: item.id, name: item.name };
  }
  if (
    item.mimeType === MIME_SHORTCUT
    && item.shortcutDetails?.targetMimeType === MIME_FOLDER
    && item.shortcutDetails?.targetId
  ) {
    return { id: item.shortcutDetails.targetId, name: item.name };
  }
  return null;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
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

/**
 * Recorre todos los subniveles de carpetas dentro de la carpeta del usuario en Google Drive (BFS),
 * evitando ciclos por accesos directos, usando fallback de tokens por subcarpeta y registrando
 * la ruta relativa de carpeta desde donde proviene cada Google Doc.
 */
async function collectDocsInPersonaFolder(
  rootFolderId: string,
  rootFolderName: string,
  candidates: ResolvedDriveToken[],
): Promise<FolderTraversalResult> {
  const visitedFolders = new Set<string>([rootFolderId]);
  const seenDocs = new Map<string, CollectedDriveDoc>();
  const permissionErrors: Array<{ folderName: string; path: string }> = [];
  let truncatedByLimit = false;

  interface QueueNode {
    id: string;
    name: string;
    pathSegments: string[];
  }

  const processChildren = (node: QueueNode, children: DriveFileMeta[], nextLevel: QueueNode[]) => {
    const immediateFolder = node.pathSegments[node.pathSegments.length - 1] || '';
    const folderPath = formatFolderPath(node.pathSegments, rootFolderName);

    for (const child of children) {
      const doc = resolveDocTarget(child);
      if (doc) {
        const cleanName = (!doc.name.trim() || isGenericBitacoraName(doc.name)) && immediateFolder
          ? immediateFolder
          : doc.name;
        const collected: CollectedDriveDoc = {
          ...doc,
          name: cleanName,
          folderPath,
        };
        const existing = seenDocs.get(doc.id);
        if (!existing || (existing.isShortcut && !collected.isShortcut)) {
          seenDocs.set(doc.id, collected);
        }
        continue;
      }

      const folder = resolveFolderTarget(child);
      if (folder && !visitedFolders.has(folder.id)) {
        if (visitedFolders.size >= MAX_FOLDERS_PER_PERSONA) {
          truncatedByLimit = true;
          continue;
        }
        visitedFolders.add(folder.id);
        const cleanFolderName = folder.name.trim() || 'Subcarpeta';
        nextLevel.push({
          id: folder.id,
          name: cleanFolderName,
          pathSegments: [...node.pathSegments, cleanFolderName],
        });
      }
    }
  };

  // Nivel 0: carpeta principal de la persona (si falla, propagar error para reportar alerta del usuario)
  const rootNode: QueueNode = {
    id: rootFolderId,
    name: rootFolderName || 'Carpeta principal',
    pathSegments: [],
  };
  const { result: rootChildren } = await withDriveTokenFallback(
    candidates,
    (c) => listFolderChildren(rootFolderId, c.token),
  );
  let currentLevel: QueueNode[] = [];
  processChildren(rootNode, rootChildren, currentLevel);

  // Subniveles 1..MAX_SUBFOLDER_DEPTH con concurrencia acotada y fallback por subcarpeta
  let depth = 1;
  while (currentLevel.length > 0 && depth <= MAX_SUBFOLDER_DEPTH) {
    const levelResults = await mapPool(currentLevel, SUBFOLDER_CONCURRENCY, async (node) => {
      try {
        const { result: children } = await withDriveTokenFallback(
          candidates,
          (c) => listFolderChildren(node.id, c.token),
        );
        return { node, children };
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          permissionErrors.push({
            folderName: node.name,
            path: node.pathSegments.join(' / '),
          });
        }
        // Si una subcarpeta no tiene permisos o apunta a un acceso directo roto, continuar con el resto
        return null;
      }
    });

    const nextLevel: QueueNode[] = [];
    for (const entry of levelResults) {
      if (!entry) continue;
      processChildren(entry.node, entry.children, nextLevel);
    }

    currentLevel = nextLevel;
    depth++;
  }

  if (currentLevel.length > 0 && depth > MAX_SUBFOLDER_DEPTH) {
    truncatedByLimit = true;
  }

  return {
    docs: Array.from(seenDocs.values()),
    foldersVisited: visitedFolders.size,
    permissionErrors,
    truncatedByLimit,
  };
}

function isCronRequestAuthorized(req: Request): { isCronAttempt: boolean; valid: boolean } {
  const cronSecret = (Deno.env.get('CRON_SECRET') || '').trim();
  const headerSecret = (req.headers.get('x-cron-secret') || '').trim();
  if (headerSecret) {
    return {
      isCronAttempt: true,
      valid: Boolean(cronSecret && timingSafeEqual(headerSecret, cronSecret)),
    };
  }
  const authHeader = (req.headers.get('Authorization') || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (cronSecret && bearer && timingSafeEqual(bearer, cronSecret)) {
    return { isCronAttempt: true, valid: true };
  }
  return { isCronAttempt: false, valid: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido. Usa POST.', 405);
  }

  let lockAcquired = false;
  let adminClientForUnlock: ReturnType<typeof getSupabaseAdmin> | null = null;

  try {
    let body: SyncRequestBody = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as SyncRequestBody;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    const cronCheck = isCronRequestAuthorized(req);
    if (cronCheck.isCronAttempt && !cronCheck.valid) {
      return errorResponse('No autorizado: CRON_SECRET inválido.', 401);
    }

    let isCron = false;
    let userId: string | null = null;
    let actorNombre = 'Sincronización automática';
    let adminClient: ReturnType<typeof getSupabaseAdmin>;

    if (cronCheck.valid) {
      isCron = true;
      adminClient = getSupabaseAdmin();
    } else {
      const auth = await requireAuthorizedWorker(req);
      userId = auth.userId;
      actorNombre = auth.perfil.nombre || auth.perfil.email;
      adminClient = auth.adminClient;
    }
    adminClientForUnlock = adminClient;

    const isAutoMode = isCron || Boolean(body.auto);
    const isGlobalSync = typeof body.persona_id !== 'number';
    const isForcedEventSync = Boolean(body.force) || body.cooldown_seconds === 0;

    // Leer estado global actual
    const { data: syncState } = await adminClient
      .from('drive_sync_state')
      .select('start_page_token, root_folder_id, auto_sync_enabled, auto_sync_interval_min')
      .eq('id', 'global')
      .maybeSingle();

    if (isAutoMode && isGlobalSync && !isForcedEventSync && syncState && syncState.auto_sync_enabled === false) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'auto_sync_desactivado',
      });
    }

    // Adquirir candado atómico para evitar carreras entre cron y múltiples pestañas
    if (isGlobalSync) {
      const defaultCooldown = isCron
        ? 25
        : Math.max(60, Number(syncState?.auto_sync_interval_min ?? 5) * 60 - 30);
      const cooldownSeconds = isAutoMode
        ? (typeof body.cooldown_seconds === 'number' ? Math.max(0, body.cooldown_seconds) : defaultCooldown)
        : 0;

      const { data: lockData } = await adminClient.rpc('srv_acquire_drive_sync_lock', {
        p_lock_seconds: 120,
        p_cooldown_seconds: cooldownSeconds,
      });
      const lock = (lockData ?? { acquired: true }) as {
        acquired?: boolean;
        reason?: string;
        ultima_sincronizacion?: string | null;
      };
      if (!lock.acquired) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: lock.reason || 'en_curso',
          ultima_sincronizacion: lock.ultima_sincronizacion || null,
        });
      }
      lockAcquired = true;
    }

    // Resolver credenciales Google (OAuth institucional / usuario -> Service Account opcional)
    const { candidates: baseCandidates, reconnectNeeded, lastAuthError } = await resolveDriveTokenCandidates(
      adminClient,
      {
        userId,
        preferInstitutional: isCron || isGlobalSync,
        includeServiceAccount: true,
      },
    );

    if (baseCandidates.length === 0) {
      if (isAutoMode) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: reconnectNeeded ? 'requiere_reconexion' : 'sin_credenciales_drive',
          message: lastAuthError || 'No hay cuenta Google Drive conectada todavía.',
        });
      }
      return errorResponse(
        lastAuthError || 'Conecta una cuenta de Google Drive para sincronizar.',
        reconnectNeeded ? 401 : 400,
        { code: reconnectNeeded ? 'reconexion_requerida' : 'configuracion' },
      );
    }

    const primaryToken = baseCandidates[0];
    const ownerTokenCache = new Map<string, ResolvedDriveToken | null>();
    for (const c of baseCandidates) {
      if (c.userId) ownerTokenCache.set(c.userId, c);
    }

    const getCandidatesForOwner = async (ownerId?: string | null): Promise<ResolvedDriveToken[]> => {
      if (!ownerId) return baseCandidates;
      if (baseCandidates.some((c) => c.userId === ownerId)) return baseCandidates;

      if (!ownerTokenCache.has(ownerId)) {
        try {
          const resolved = await getUserDriveToken(adminClient, ownerId);
          ownerTokenCache.set(ownerId, resolved);
        } catch {
          ownerTokenCache.set(ownerId, null);
        }
      }
      const ownerToken = ownerTokenCache.get(ownerId);
      return ownerToken ? [...baseCandidates, ownerToken] : baseCandidates;
    };

    const rawRootFolder = (
      body.root_folder_id
      || syncState?.root_folder_id
      || Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')
      || ''
    ).trim();
    const rootFolderId = rawRootFolder ? normalizeFolderId(rawRootFolder) : '';
    if (rawRootFolder && !rootFolderId) {
      return errorResponse('El ID o enlace de la carpeta raíz en Google Drive no es válido.');
    }

    const syncTitles = body.sync_titles !== false;
    const crearFaltantes = body.crear_faltantes !== false;

    const report = {
      personas_procesadas: 0,
      carpetas_vinculadas: 0,
      subcarpetas_recorridas: 0,
      nuevas_personas: 0,
      nuevas_bitacoras: 0,
      bitacoras_actualizadas: 0,
      renombres_detectados: 0,
      errores_permisos: 0,
      no_encontradas: 0,
      auth_source: primaryToken.source,
      detalles: [] as Array<{ tipo: string; mensaje: string }>,
    };

    // Cargar personas objetivo
    let personasQuery = adminClient
      .from('personas')
      .select('id, codigo, nombre, drive_folder_id, drive_folder_name, linked_by_user_id')
      .order('codigo');

    if (typeof body.persona_id === 'number') {
      personasQuery = personasQuery.eq('id', body.persona_id);
    }

    const { data: personasIniciales, error: personasErr } = await personasQuery;
    if (personasErr) {
      return errorResponse(`Error leyendo personas: ${personasErr.message}`, 500);
    }

    const personas = (personasIniciales ?? []) as PersonaRow[];
    if (typeof body.persona_id === 'number' && personas.length === 0) {
      return errorResponse('Persona no encontrada.', 404);
    }

    // Detectar una sola vez si la migración 0009 (drive_folder_path) ya está aplicada
    const { error: folderPathProbeErr } = await adminClient
      .from('bitacoras')
      .select('drive_folder_path')
      .limit(1);
    const supportsFolderPath = !isMissingColumnError(folderPathProbeErr);
    const bitacoraSelectFields = supportsFolderPath
      ? 'id, persona_id, titulo, url_docs, google_doc_id, orden, drive_modified_time, drive_revision_id, estado_sync, linked_by_user_id, drive_folder_path'
      : 'id, persona_id, titulo, url_docs, google_doc_id, orden, drive_modified_time, drive_revision_id, estado_sync, linked_by_user_id';

    // Paso 1: Si hay carpeta raíz configurada, detectar carpetas de personas en Drive
    if (rootFolderId && isGlobalSync) {
      const { result: rootItems } = await withDriveTokenFallback(
        baseCandidates,
        (c) => listFolderChildren(rootFolderId, c.token),
      );
      const driveFolders = rootItems
        .map((item) => resolveFolderTarget(item))
        .filter((f): f is { id: string; name: string } => f !== null);

      for (const folder of driveFolders) {
        const parsed = parseFolderIdentity(folder.name, folder.id);
        const rawFolderLow = folder.name.trim().toLowerCase();
        const parsedNameLow = parsed.nombre.trim().toLowerCase();
        const matched = personas.find((p) => normalizeFolderId(p.drive_folder_id) === folder.id)
          || personas.find((p) => p.codigo.toUpperCase() === parsed.codigo.toUpperCase())
          || personas.find((p) =>
            !normalizeFolderId(p.drive_folder_id)
            && (p.nombre.trim().toLowerCase() === rawFolderLow || p.nombre.trim().toLowerCase() === parsedNameLow)
          );

        if (matched && (matched.drive_folder_id !== folder.id || matched.drive_folder_name !== folder.name)) {
          const { error: updErr } = await adminClient
            .from('personas')
            .update({
              drive_folder_id: folder.id,
              drive_folder_name: folder.name.slice(0, 160),
            })
            .eq('id', matched.id);
          if (!updErr) {
            const changedId = matched.drive_folder_id !== folder.id;
            matched.drive_folder_id = folder.id;
            matched.drive_folder_name = folder.name;
            if (changedId) {
              report.carpetas_vinculadas++;
              report.detalles.push({
                tipo: 'carpeta_vinculada',
                mensaje: `${matched.codigo} vinculada a carpeta "${folder.name}".`,
              });
            }
          }
        } else if (!matched && crearFaltantes) {
          const { data: created, error: createErr } = await adminClient
            .from('personas')
            .insert({
              codigo: parsed.codigo,
              nombre: parsed.nombre,
              drive_folder_id: folder.id,
              drive_folder_name: folder.name.slice(0, 160),
              linked_by_user_id: primaryToken.userId ?? userId,
            })
            .select('id, codigo, nombre, drive_folder_id, drive_folder_name, linked_by_user_id')
            .single();

          if (!createErr && created) {
            personas.push(created as PersonaRow);
            report.nuevas_personas++;
            report.detalles.push({
              tipo: 'persona_creada',
              mensaje: `Se detectó carpeta "${folder.name}" y se registró como ${created.codigo}.`,
            });
          } else if (createErr) {
            report.detalles.push({
              tipo: 'error',
              mensaje: `No se pudo registrar carpeta "${folder.name}" (${parsed.codigo}): ${createErr.message}`,
            });
          }
        }
      }
    } else if (rootFolderId && !isGlobalSync && personas.length === 1 && !normalizeFolderId(personas[0].drive_folder_id)) {
      try {
        const targetPersona = personas[0];
        const { result: rootItems } = await withDriveTokenFallback(
          baseCandidates,
          (c) => listFolderChildren(rootFolderId, c.token),
        );
        const driveFolders = rootItems
          .map((item) => resolveFolderTarget(item))
          .filter((f): f is { id: string; name: string } => f !== null);
        const targetCode = targetPersona.codigo.trim().toUpperCase();
        const targetName = targetPersona.nombre.trim().toLowerCase();
        const matchedFolder = driveFolders.find((folder) => {
          const parsed = parseFolderIdentity(folder.name, folder.id);
          if (parsed.codigo.toUpperCase() === targetCode) return true;
          const rawName = folder.name.trim().toLowerCase();
          return rawName === targetName || rawName === targetCode.toLowerCase();
        });
        if (matchedFolder) {
          const { error: updErr } = await adminClient
            .from('personas')
            .update({
              drive_folder_id: matchedFolder.id,
              drive_folder_name: matchedFolder.name.slice(0, 160),
            })
            .eq('id', targetPersona.id);
          if (!updErr) {
            targetPersona.drive_folder_id = matchedFolder.id;
            targetPersona.drive_folder_name = matchedFolder.name;
            report.carpetas_vinculadas++;
            report.detalles.push({
              tipo: 'carpeta_vinculada',
              mensaje: `${targetPersona.codigo} vinculada a carpeta "${matchedFolder.name}".`,
            });
          }
        }
      } catch {
        // Si no se pudo consultar la carpeta raíz, continuar verificando las bitácoras de la persona
      }
    }

    // Paso 2: Sincronizar Docs en TODOS los subniveles de cada carpeta de persona que tenga drive_folder_id
    const personasConCarpeta = personas
      .map((p) => ({
        persona: p,
        folderId: normalizeFolderId(p.drive_folder_id) || p.drive_folder_id.trim(),
      }))
      .filter((entry) => entry.folderId !== '');
    const syncedDocIdsInStep2 = new Set<string>();
    const personaOwnerById = new Map<number, string | null>();
    for (const p of personas) {
      personaOwnerById.set(p.id, p.linked_by_user_id ?? null);
    }
    report.personas_procesadas = personas.length;
    let bitacorasModificadas = 0;

    await mapPool(personasConCarpeta, PERSONA_CONCURRENCY, async ({ persona, folderId }) => {
      try {
        const folderCandidates = await getCandidatesForOwner(persona.linked_by_user_id);
        let effectiveFolderId = folderId;
        let effectiveFolderName = (persona.drive_folder_name || '').trim();

        // Si falta el nombre de la carpeta (o se vinculó un acceso directo por ID), resolver metadatos una vez
        if (!effectiveFolderName) {
          try {
            const { result: folderMeta } = await withDriveTokenFallback(
              folderCandidates,
              (c) => getFileMetadata(effectiveFolderId, c.token),
            );
            const resolvedRoot = resolveFolderTarget(folderMeta);
            const nextFolderId = resolvedRoot?.id || effectiveFolderId;
            const nextFolderName = (folderMeta.name || '').trim().slice(0, 160);

            if (nextFolderId !== effectiveFolderId || nextFolderName) {
              effectiveFolderId = nextFolderId;
              effectiveFolderName = nextFolderName;
              const personaUpdate: Record<string, unknown> = {};
              if (nextFolderId !== persona.drive_folder_id) {
                personaUpdate.drive_folder_id = nextFolderId;
              }
              if (nextFolderName) {
                personaUpdate.drive_folder_name = nextFolderName;
              }
              if (Object.keys(personaUpdate).length > 0) {
                await adminClient.from('personas').update(personaUpdate).eq('id', persona.id);
                persona.drive_folder_id = nextFolderId;
                persona.drive_folder_name = nextFolderName;
              }
            }
          } catch {
            // Si falla la consulta de metadatos, intentar listar directamente
          }
        }

        const traversal = await collectDocsInPersonaFolder(
          effectiveFolderId,
          effectiveFolderName,
          folderCandidates,
        );
        report.subcarpetas_recorridas += Math.max(0, traversal.foldersVisited - 1);

        for (const permErr of traversal.permissionErrors) {
          report.errores_permisos++;
          report.detalles.push({
            tipo: 'sin_permiso',
            mensaje: `Sin permiso en subcarpeta "${permErr.path || permErr.folderName}" de ${persona.codigo}.`,
          });
        }

        if (traversal.truncatedByLimit) {
          report.detalles.push({
            tipo: 'aviso',
            mensaje: `${persona.codigo}: se alcanzó el límite de recorrido de subcarpetas (${MAX_FOLDERS_PER_PERSONA} carpetas / ${MAX_SUBFOLDER_DEPTH} niveles).`,
          });
        }

        const { data: existingLogs, error: existingErr } = await adminClient
          .from('bitacoras')
          .select(bitacoraSelectFields)
          .eq('persona_id', persona.id)
          .order('orden', { ascending: true });

        if (existingErr) {
          report.detalles.push({
            tipo: 'error',
            mensaje: `Error leyendo bitácoras de ${persona.codigo}: ${existingErr.message}`,
          });
          return;
        }

        const logs = (existingLogs ?? []) as unknown as BitacoraRow[];
        let nextOrder = logs.reduce((max, item) => Math.max(max, item.orden + 1), 0);

        for (const doc of traversal.docs) {
          if (!doc.isShortcut) {
            syncedDocIdsInStep2.add(doc.id);
          }
          const normalizedTitle = doc.name.trim().slice(0, 160);
          const byId = logs.find((b) => b.google_doc_id === doc.id);
          const byTitle = !byId
            ? logs.find((b) => !b.google_doc_id && b.titulo.trim().toLowerCase() === normalizedTitle.toLowerCase())
            : undefined;
          const target = byId || byTitle;
          const docUrl = normalizeDocUrl(doc.id, doc.webViewLink);

          if (target) {
            const titleChanged = Boolean(byId && syncTitles && normalizedTitle && target.titulo !== normalizedTitle);
            const currentFolderPath = (target.drive_folder_path || '').trim();
            const folderPathChanged = Boolean(
              supportsFolderPath && doc.folderPath && currentFolderPath !== doc.folderPath,
            );
            const metaChanged = target.url_docs !== docUrl
              || target.google_doc_id !== doc.id
              || target.estado_sync !== 'sincronizada'
              || Boolean(doc.modifiedTime && doc.modifiedTime !== target.drive_modified_time)
              || Boolean(doc.headRevisionId && doc.headRevisionId !== target.drive_revision_id)
              || titleChanged
              || folderPathChanged;

            if (metaChanged) {
              const updatePayload: Record<string, unknown> = {
                url_docs: docUrl,
                google_doc_id: doc.id,
                estado_sync: 'sincronizada',
                drive_modified_time: doc.modifiedTime ?? target.drive_modified_time,
                drive_revision_id: doc.headRevisionId ?? target.drive_revision_id,
              };
              if (titleChanged) {
                updatePayload.titulo = normalizedTitle;
                report.renombres_detectados++;
                report.detalles.push({
                  tipo: 'renombre',
                  mensaje: `${persona.codigo}: "${target.titulo}" renombrada a "${normalizedTitle}".`,
                });
              }
              if (folderPathChanged) {
                updatePayload.drive_folder_path = doc.folderPath;
              }
              const { error: updErr } = await adminClient
                .from('bitacoras')
                .update(updatePayload)
                .eq('id', target.id);
              if (updErr) {
                report.detalles.push({
                  tipo: 'error',
                  mensaje: `${persona.codigo}: no se pudo actualizar "${target.titulo}": ${updErr.message}`,
                });
              } else {
                target.google_doc_id = doc.id;
                if (titleChanged) target.titulo = normalizedTitle;
                if (folderPathChanged) target.drive_folder_path = doc.folderPath;
                bitacorasModificadas++;
              }
            }
            if (!doc.isShortcut) {
              report.bitacoras_actualizadas++;
            }
          } else {
            const insertPayload: Record<string, unknown> = {
              persona_id: persona.id,
              titulo: normalizedTitle || 'Bitácora Drive',
              url_docs: docUrl,
              google_doc_id: doc.id,
              orden: nextOrder++,
              drive_modified_time: doc.modifiedTime ?? null,
              drive_revision_id: doc.headRevisionId ?? '',
              estado_sync: 'sincronizada',
              linked_by_user_id: persona.linked_by_user_id ?? primaryToken.userId ?? userId,
              ...(supportsFolderPath ? { drive_folder_path: doc.folderPath } : {}),
            };
            const { data: inserted, error: insertErr } = await adminClient
              .from('bitacoras')
              .insert(insertPayload)
              .select(bitacoraSelectFields)
              .single();

            if (insertErr) {
              report.detalles.push({
                tipo: 'error',
                mensaje: `${persona.codigo}: no se pudo guardar "${normalizedTitle}": ${insertErr.message}`,
              });
            } else if (inserted) {
              logs.push(inserted as unknown as BitacoraRow);
              report.nuevas_bitacoras++;
              report.detalles.push({
                tipo: 'nueva_bitacora',
                mensaje: `${persona.codigo}: nuevo Doc detectado "${normalizedTitle}"${doc.folderPath ? ` (carpeta: ${doc.folderPath})` : ''}.`,
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          report.errores_permisos++;
          report.detalles.push({
            tipo: 'sin_permiso',
            mensaje: `Sin permiso en carpeta Drive de ${persona.codigo}.`,
          });
        } else {
          report.detalles.push({
            tipo: 'error',
            mensaje: `Error leyendo carpeta de ${persona.codigo}: ${(err as Error).message}`,
          });
        }
      }
    });

    // Paso 3: Verificar metadatos y permisos de bitácoras ya vinculadas por google_doc_id
    let logsQuery = adminClient
      .from('bitacoras')
      .select(bitacoraSelectFields);

    if (typeof body.persona_id === 'number') {
      logsQuery = logsQuery.eq('persona_id', body.persona_id);
    }

    const { data: allLogs } = await logsQuery;
    const bitacoras = (allLogs ?? []) as unknown as BitacoraRow[];
    const linkedLogs = bitacoras.filter(
      (b) => b.google_doc_id.trim() !== '' && !syncedDocIdsInStep2.has(b.google_doc_id.trim()),
    );
    const unlinkedLogs = bitacoras.filter((b) => b.google_doc_id.trim() === '' && b.estado_sync !== 'sin_enlace');

    if (unlinkedLogs.length > 0) {
      await adminClient
        .from('bitacoras')
        .update({ estado_sync: 'sin_enlace' })
        .in('id', unlinkedLogs.map((b) => b.id));
    }

    const parentFolderNamePromises = new Map<string, Promise<string>>();
    const resolveParentFolderName = (parentId: string, token: string): Promise<string> => {
      if (!parentId) return Promise.resolve('');
      const existing = parentFolderNamePromises.get(parentId);
      if (existing) return existing;
      const promise = getFileMetadata(parentId, token)
        .then((parentMeta) => (parentMeta.name || '').trim().slice(0, 300))
        .catch(() => '');
      parentFolderNamePromises.set(parentId, promise);
      return promise;
    };

    await mapPool(linkedLogs, 4, async (b) => {
      try {
        const ownerId = b.linked_by_user_id || personaOwnerById.get(b.persona_id) || null;
        const docCandidates = await getCandidatesForOwner(ownerId);
        const { result: meta, used } = await withDriveTokenFallback(
          docCandidates,
          (c) => getFileMetadata(b.google_doc_id, c.token),
        );

        if (meta.trashed) {
          report.no_encontradas++;
          if (b.estado_sync !== 'no_encontrada') {
            await adminClient
              .from('bitacoras')
              .update({ estado_sync: 'no_encontrada' })
              .eq('id', b.id);
            bitacorasModificadas++;
          }
          report.detalles.push({
            tipo: 'papelera',
            mensaje: `"${b.titulo}" está en la papelera de Google Drive.`,
          });
          return;
        }

        let resolvedFolderPath = (b.drive_folder_path || '').trim();
        if (supportsFolderPath && !resolvedFolderPath && meta.parents && meta.parents.length > 0) {
          resolvedFolderPath = await resolveParentFolderName(meta.parents[0], used.token);
        }

        const metaNameTrimmed = (meta.name || '').trim();
        const renamed = Boolean(
          syncTitles
          && metaNameTrimmed
          && !isGenericBitacoraName(metaNameTrimmed)
          && metaNameTrimmed !== b.titulo.trim(),
        );
        const folderPathChanged = Boolean(
          supportsFolderPath && resolvedFolderPath && resolvedFolderPath !== (b.drive_folder_path || '').trim(),
        );
        const metaChanged = b.estado_sync !== 'sincronizada'
          || Boolean(meta.modifiedTime && meta.modifiedTime !== b.drive_modified_time)
          || Boolean(meta.headRevisionId && meta.headRevisionId !== b.drive_revision_id)
          || renamed
          || folderPathChanged;

        if (metaChanged) {
          const updatePayload: Record<string, unknown> = {
            estado_sync: 'sincronizada',
            drive_modified_time: meta.modifiedTime ?? b.drive_modified_time,
            drive_revision_id: meta.headRevisionId ?? b.drive_revision_id,
          };
          if (renamed) {
            updatePayload.titulo = metaNameTrimmed.slice(0, 160);
            report.renombres_detectados++;
            report.detalles.push({
              tipo: 'renombre',
              mensaje: `"${b.titulo}" fue renombrada en Drive a "${metaNameTrimmed}".`,
            });
          }
          if (folderPathChanged) {
            updatePayload.drive_folder_path = resolvedFolderPath;
          }
          await adminClient.from('bitacoras').update(updatePayload).eq('id', b.id);
          bitacorasModificadas++;
        }
        report.bitacoras_actualizadas++;
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          report.errores_permisos++;
          if (b.estado_sync !== 'sin_permiso') {
            bitacorasModificadas++;
          }
          await adminClient.from('bitacoras').update({ estado_sync: 'sin_permiso' }).eq('id', b.id);
          report.detalles.push({
            tipo: 'sin_permiso',
            mensaje: `Sin permiso para leer "${b.titulo}" (${b.google_doc_id}).`,
          });
        } else if (err instanceof GoogleApiError && err.code === 'no_encontrada') {
          report.no_encontradas++;
          if (b.estado_sync !== 'no_encontrada') {
            bitacorasModificadas++;
          }
          await adminClient.from('bitacoras').update({ estado_sync: 'no_encontrada' }).eq('id', b.id);
          report.detalles.push({
            tipo: 'no_encontrada',
            mensaje: `No se encontró "${b.titulo}" en Google Drive.`,
          });
        } else {
          report.detalles.push({
            tipo: 'error',
            mensaje: `Error verificando "${b.titulo}": ${(err as Error).message}`,
          });
        }
      }
    });

    // Asegurar start_page_token inicial sin pisar el cursor existente de notificar-cambios
    let nextStartToken = (syncState?.start_page_token || '').trim();
    if (!nextStartToken) {
      try {
        nextStartToken = await getStartPageToken(primaryToken.token);
      } catch {
        // continuar sin romper la sincronización si no se pudo inicializar el cursor
      }
    }

    const nowIso = new Date().toISOString();
    const totalNovedades = report.carpetas_vinculadas
      + report.nuevas_personas
      + report.nuevas_bitacoras
      + report.renombres_detectados;

    const prefijoModo = isAutoMode ? 'Sincronización automática' : 'Sincronización';
    const estadoTexto = `${prefijoModo}: ${report.bitacoras_actualizadas} bitácoras al día, ${report.nuevas_bitacoras} nuevas, ${report.errores_permisos} sin permiso.`;

    const authMode = primaryToken.source === 'service_account'
      ? 'service_account'
      : 'oauth_institucional';

    const stateUpsert: Record<string, unknown> = {
      id: 'global',
      start_page_token: nextStartToken,
      ultima_sincronizacion: nowIso,
      ultimo_estado: estadoTexto,
      actualizado: nowIso,
    };
    if (isGlobalSync) {
      stateUpsert.auth_mode = authMode;
      stateUpsert.connection_status = reconnectNeeded && primaryToken.source === 'service_account'
        ? 'requiere_reconexion'
        : 'conectado';
      if (primaryToken.source !== 'service_account' && primaryToken.email) {
        stateUpsert.institutional_email = primaryToken.email;
      }
    }

    await adminClient.from('drive_sync_state').upsert(stateUpsert);

    // En modo automático, registrar en Actividad solo cuando realmente se detectaron novedades o alertas
    const shouldLogActivity = !isAutoMode
      || totalNovedades > 0
      || report.errores_permisos > 0
      || report.no_encontradas > 0;

    if (shouldLogActivity) {
      const desc = isAutoMode
        ? `Sincronización automática de Drive: ${report.nuevas_personas} usuarios nuevos, ${report.nuevas_bitacoras} bitácoras nuevas, ${report.renombres_detectados} renombres.`
        : `Sincronización con Drive ejecutada (${report.bitacoras_actualizadas} bitácoras verificadas, ${report.nuevas_bitacoras} nuevas).`;

      await adminClient.from('actividad').insert({
        descripcion: desc.slice(0, 250),
        persona_id: typeof body.persona_id === 'number' ? body.persona_id : null,
        actor_id: userId,
        actor_nombre: isAutoMode ? 'Sincronización automática' : actorNombre,
      });
    }

    return jsonResponse({
      ok: true,
      skipped: false,
      auto: isAutoMode,
      hubo_cambios: totalNovedades > 0 || bitacorasModificadas > 0,
      ...report,
      ultima_sincronizacion: nowIso,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.status);
    }
    if (err instanceof GoogleApiError) {
      return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502, {
        code: err.code,
      });
    }
    return errorResponse(`Error inesperado en sync-drive: ${(err as Error).message}`, 500);
  } finally {
    if (lockAcquired && adminClientForUnlock) {
      try {
        await adminClientForUnlock.rpc('srv_release_drive_sync_lock');
      } catch {
        // best-effort unlock (el lock también expira automáticamente por sync_lock_until)
      }
    }
  }
});
