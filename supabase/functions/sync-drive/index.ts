import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import {
  type DriveFileMeta,
  exportDocAsText,
  getFileMetadata,
  getGoogleAccessToken,
  getStartPageToken,
  GoogleApiError,
  listFolderChildren,
  normalizeDocUrl,
  normalizeFolderId,
  parseFolderIdentity,
} from '../_shared/google.ts';
import { AuthError, requireAuthorizedWorker } from '../_shared/supabase.ts';

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_SHORTCUT = 'application/vnd.google-apps.shortcut';

interface SyncRequestBody {
  persona_id?: number;
  root_folder_id?: string;
  sync_titles?: boolean;
  crear_faltantes?: boolean;
}

interface PersonaRow {
  id: number;
  codigo: string;
  nombre: string;
  drive_folder_id: string;
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
}

function resolveDocTarget(item: DriveFileMeta): { id: string; name: string; webViewLink?: string; modifiedTime?: string; headRevisionId?: string } | null {
  if (item.mimeType === MIME_DOC) {
    return {
      id: item.id,
      name: item.name,
      webViewLink: item.webViewLink,
      modifiedTime: item.modifiedTime,
      headRevisionId: item.headRevisionId,
    };
  }
  if (item.mimeType === MIME_SHORTCUT && item.shortcutDetails?.targetMimeType === MIME_DOC && item.shortcutDetails?.targetId) {
    return {
      id: item.shortcutDetails.targetId,
      name: item.name,
    };
  }
  return null;
}

async function collectDocsInPersonaFolder(
  folderId: string,
  token: string,
): Promise<Array<{ id: string; name: string; webViewLink?: string; modifiedTime?: string; headRevisionId?: string }>> {
  const children = await listFolderChildren(folderId, token);
  const docs: Array<{ id: string; name: string; webViewLink?: string; modifiedTime?: string; headRevisionId?: string }> = [];
  const subfolders: DriveFileMeta[] = [];

  for (const child of children) {
    const doc = resolveDocTarget(child);
    if (doc) {
      docs.push(doc);
    } else if (child.mimeType === MIME_FOLDER) {
      subfolders.push(child);
    }
  }

  // Soportar 1 nivel adicional de subcarpetas por bitácora (estructura heredada en Drive de CEMIPRE)
  for (const sub of subfolders) {
    try {
      const subChildren = await listFolderChildren(sub.id, token);
      for (const item of subChildren) {
        const doc = resolveDocTarget(item);
        if (doc) {
          const cleanName = doc.name && doc.name.toLowerCase() !== 'bitacora' && doc.name.toLowerCase() !== 'bitácora'
            ? doc.name
            : sub.name;
          docs.push({ ...doc, name: cleanName });
        }
      }
    } catch {
      // Si una subcarpeta no tiene permisos, seguimos con el resto sin romper la sincronización
    }
  }

  return docs;
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido. Usa POST.', 405);
  }

  try {
    const { userId, perfil, adminClient } = await requireAuthorizedWorker(req);

    let body: SyncRequestBody = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as SyncRequestBody;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    const token = await getGoogleAccessToken();
    const rawRootFolder = (body.root_folder_id || Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID') || '').trim();
    const rootFolderId = rawRootFolder ? normalizeFolderId(rawRootFolder) : '';
    if (rawRootFolder && !rootFolderId) {
      return errorResponse('El ID o enlace de la carpeta raíz en Google Drive no es válido.');
    }
    const syncTitles = body.sync_titles !== false;
    const crearFaltantes = body.crear_faltantes !== false;

    const report = {
      personas_procesadas: 0,
      carpetas_vinculadas: 0,
      nuevas_personas: 0,
      nuevas_bitacoras: 0,
      bitacoras_actualizadas: 0,
      renombres_detectados: 0,
      errores_permisos: 0,
      no_encontradas: 0,
      detalles: [] as Array<{ tipo: string; mensaje: string }>,
    };

    // Cargar personas objetivo
    let personasQuery = adminClient
      .from('personas')
      .select('id, codigo, nombre, drive_folder_id')
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

    // Paso 1: Si hay carpeta raíz configurada, detectar carpetas de personas en Drive
    if (rootFolderId && typeof body.persona_id !== 'number') {
      const rootItems = await listFolderChildren(rootFolderId, token);
      const driveFolders = rootItems.filter((item) => item.mimeType === MIME_FOLDER);

      for (const folder of driveFolders) {
        const parsed = parseFolderIdentity(folder.name, folder.id);
        const matched = personas.find((p) => normalizeFolderId(p.drive_folder_id) === folder.id)
          || personas.find((p) => p.codigo.toUpperCase() === parsed.codigo.toUpperCase());

        if (matched && matched.drive_folder_id !== folder.id) {
          const { error: updErr } = await adminClient
            .from('personas')
            .update({ drive_folder_id: folder.id })
            .eq('id', matched.id);
          if (!updErr) {
            matched.drive_folder_id = folder.id;
            report.carpetas_vinculadas++;
            report.detalles.push({
              tipo: 'carpeta_vinculada',
              mensaje: `${matched.codigo} vinculada a carpeta "${folder.name}".`,
            });
          }
        } else if (!matched && crearFaltantes) {
          const { data: created, error: createErr } = await adminClient
            .from('personas')
            .insert({
              codigo: parsed.codigo,
              nombre: parsed.nombre,
              drive_folder_id: folder.id,
            })
            .select('id, codigo, nombre, drive_folder_id')
            .single();

          if (!createErr && created) {
            personas.push(created as PersonaRow);
            report.nuevas_personas++;
            report.detalles.push({
              tipo: 'persona_creada',
              mensaje: `Se detectó carpeta "${folder.name}" y se registró como ${created.codigo}.`,
            });
          }
        }
      }
    }

    // Paso 2: Sincronizar Docs dentro de cada carpeta de persona que tenga drive_folder_id
    const personasConCarpeta = personas
      .map((p) => ({
        persona: p,
        folderId: normalizeFolderId(p.drive_folder_id) || p.drive_folder_id.trim(),
      }))
      .filter((entry) => entry.folderId !== '');
    const syncedDocIdsInStep2 = new Set<string>();
    report.personas_procesadas = personas.length;

    for (const { persona, folderId } of personasConCarpeta) {
      try {
        const docsEnDrive = await collectDocsInPersonaFolder(folderId, token);
        const { data: existingLogs } = await adminClient
          .from('bitacoras')
          .select('id, persona_id, titulo, url_docs, google_doc_id, orden, drive_modified_time, drive_revision_id, estado_sync')
          .eq('persona_id', persona.id)
          .order('orden', { ascending: true });

        const logs = (existingLogs ?? []) as BitacoraRow[];
        let nextOrder = logs.reduce((max, item) => Math.max(max, item.orden + 1), 0);

        for (const doc of docsEnDrive) {
          syncedDocIdsInStep2.add(doc.id);
          const normalizedTitle = doc.name.trim().slice(0, 160);
          const byId = logs.find((b) => b.google_doc_id === doc.id);
          const byTitle = !byId
            ? logs.find((b) => !b.google_doc_id && b.titulo.trim().toLowerCase() === normalizedTitle.toLowerCase())
            : undefined;
          const target = byId || byTitle;
          const docUrl = normalizeDocUrl(doc.id, doc.webViewLink);

          if (target) {
            const titleChanged = byId && syncTitles && normalizedTitle && target.titulo !== normalizedTitle;
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
            await adminClient.from('bitacoras').update(updatePayload).eq('id', target.id);
            target.google_doc_id = doc.id;
            report.bitacoras_actualizadas++;
          } else {
            const { data: inserted } = await adminClient
              .from('bitacoras')
              .insert({
                persona_id: persona.id,
                titulo: normalizedTitle || 'Bitácora Drive',
                url_docs: docUrl,
                google_doc_id: doc.id,
                orden: nextOrder++,
                drive_modified_time: doc.modifiedTime ?? null,
                drive_revision_id: doc.headRevisionId ?? '',
                estado_sync: 'sincronizada',
              })
              .select('id, persona_id, titulo, url_docs, google_doc_id, orden, drive_modified_time, drive_revision_id, estado_sync')
              .single();

            if (inserted) {
              logs.push(inserted as BitacoraRow);
              report.nuevas_bitacoras++;
              report.detalles.push({
                tipo: 'nueva_bitacora',
                mensaje: `${persona.codigo}: nuevo Doc detectado "${normalizedTitle}".`,
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
    }

    // Paso 3: Verificar metadatos y permisos de bitácoras ya vinculadas por google_doc_id
    let logsQuery = adminClient
      .from('bitacoras')
      .select('id, persona_id, titulo, url_docs, google_doc_id, orden, drive_modified_time, drive_revision_id, estado_sync');

    if (typeof body.persona_id === 'number') {
      logsQuery = logsQuery.eq('persona_id', body.persona_id);
    }

    const { data: allLogs } = await logsQuery;
    const bitacoras = (allLogs ?? []) as BitacoraRow[];
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

    await mapPool(linkedLogs, 4, async (b) => {
      try {
        const meta = await getFileMetadata(b.google_doc_id, token);
        if (meta.trashed) {
          report.no_encontradas++;
          await adminClient
            .from('bitacoras')
            .update({ estado_sync: 'no_encontrada' })
            .eq('id', b.id);
          report.detalles.push({
            tipo: 'papelera',
            mensaje: `"${b.titulo}" está en la papelera de Google Drive.`,
          });
          return;
        }

        const updatePayload: Record<string, unknown> = {
          estado_sync: 'sincronizada',
          drive_modified_time: meta.modifiedTime ?? b.drive_modified_time,
          drive_revision_id: meta.headRevisionId ?? b.drive_revision_id,
        };
        if (syncTitles && meta.name && meta.name.trim() !== b.titulo.trim()) {
          updatePayload.titulo = meta.name.trim().slice(0, 160);
          report.renombres_detectados++;
          report.detalles.push({
            tipo: 'renombre',
            mensaje: `"${b.titulo}" fue renombrada en Drive a "${meta.name.trim()}".`,
          });
        }
        await adminClient.from('bitacoras').update(updatePayload).eq('id', b.id);
        report.bitacoras_actualizadas++;
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          report.errores_permisos++;
          await adminClient.from('bitacoras').update({ estado_sync: 'sin_permiso' }).eq('id', b.id);
          report.detalles.push({
            tipo: 'sin_permiso',
            mensaje: `Sin permiso para leer "${b.titulo}" (${b.google_doc_id}).`,
          });
        } else if (err instanceof GoogleApiError && err.code === 'no_encontrada') {
          report.no_encontradas++;
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

    // Asegurar que exista un start_page_token inicial para futuras notificaciones automáticas
    const { data: syncState } = await adminClient
      .from('drive_sync_state')
      .select('start_page_token')
      .eq('id', 'global')
      .maybeSingle();

    let nextStartToken = syncState?.start_page_token ?? '';
    if (!nextStartToken) {
      nextStartToken = await getStartPageToken(token);
    }

    const estadoTexto = `Sincronización completada: ${report.bitacoras_actualizadas} actualizadas, ${report.nuevas_bitacoras} nuevas, ${report.errores_permisos} sin permiso.`;
    await adminClient.from('drive_sync_state').upsert({
      id: 'global',
      start_page_token: nextStartToken,
      ultima_sincronizacion: new Date().toISOString(),
      ultimo_estado: estadoTexto,
      actualizado: new Date().toISOString(),
    });

    await adminClient.from('actividad').insert({
      descripcion: `Sincronización con Drive ejecutada (${report.bitacoras_actualizadas} bitácoras verificadas, ${report.nuevas_bitacoras} nuevas).`,
      persona_id: typeof body.persona_id === 'number' ? body.persona_id : null,
      actor_id: userId,
      actor_nombre: perfil.nombre || perfil.email,
    });

    // Nota: exportDocAsText se importa para validar lectura si se amplía el comando
    void exportDocAsText;

    return jsonResponse({ ok: true, ...report, ultima_sincronizacion: new Date().toISOString() });
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
  }
});
