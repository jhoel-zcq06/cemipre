import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import {
  createDriveItem,
  type DriveFileMeta,
  getFileMetadata,
  getGoogleAccessToken,
  GOOGLE_WRITE_SCOPES,
  GoogleApiError,
  listFolderChildren,
  normalizeDocUrl,
  normalizeFolderId,
  parseFolderIdentity,
} from '../_shared/google.ts';
import { AuthError, requireAuthorizedWorker } from '../_shared/supabase.ts';

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_DOC = 'application/vnd.google-apps.document';

interface CreateDriveBitacoraBody {
  persona_id?: number;
  titulo?: string;
}

interface PersonaRow {
  id: number;
  codigo: string;
  nombre: string;
  drive_folder_id: string;
}

interface DriveCreationResult {
  userFolderId: string;
  bitacoraFolderId: string;
  docId: string;
  docUrl: string;
}

function findMatchingUserFolder(folders: DriveFileMeta[], persona: PersonaRow): DriveFileMeta | undefined {
  const targetCode = persona.codigo.trim().toLowerCase();
  const targetName = persona.nombre.trim().toLowerCase();

  return folders.find((folder) => {
    const parsed = parseFolderIdentity(folder.name, folder.id);
    if (parsed.codigo.toLowerCase() === targetCode) return true;
    const rawName = folder.name.trim().toLowerCase();
    if (rawName === targetCode || rawName === targetName) return true;
    return (
      rawName.startsWith(`${targetCode} `)
      || rawName.startsWith(`${targetCode}-`)
      || rawName.startsWith(`${targetCode}_`)
    );
  });
}

async function createViaAppsScript(params: {
  webhookUrl: string;
  webhookSecret: string;
  rootFolderId: string;
  userFolderId: string;
  persona: PersonaRow;
  bitacoraName: string;
}): Promise<DriveCreationResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.webhookUrl);
  } catch {
    throw new Error('GOOGLE_DRIVE_WEBHOOK_URL no tiene un formato de URL válido.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('GOOGLE_DRIVE_WEBHOOK_URL debe usar HTTPS.');
  }

  const userFolderName = `${params.persona.codigo} - ${params.persona.nombre}`.slice(0, 120);
  const response = await fetch(params.webhookUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: params.webhookSecret,
      action: 'create_bitacora',
      root_folder_id: params.rootFolderId,
      user_folder_id: params.userFolderId,
      user_codigo: params.persona.codigo,
      user_nombre: params.persona.nombre,
      user_folder_name: userFolderName,
      bitacora_name: params.bitacoraName,
    }),
  });

  const rawText = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(
      'La Web App de Google Apps Script devolvió HTML en lugar de JSON. Verifica que esté publicada como "Ejecutar como: Yo" y "Quién tiene acceso: Cualquier usuario".',
    );
  }

  if (!response.ok || !payload.ok || typeof payload.doc_id !== 'string' || !payload.doc_id) {
    const detail = typeof payload.error === 'string' && payload.error
      ? payload.error
      : `Apps Script respondió HTTP ${response.status}.`;
    throw new Error(detail);
  }

  return {
    userFolderId: typeof payload.user_folder_id === 'string' && payload.user_folder_id
      ? payload.user_folder_id
      : params.userFolderId,
    bitacoraFolderId: typeof payload.bitacora_folder_id === 'string' ? payload.bitacora_folder_id : '',
    docId: payload.doc_id,
    docUrl: typeof payload.doc_url === 'string' && payload.doc_url
      ? payload.doc_url
      : normalizeDocUrl(payload.doc_id),
  };
}

async function createViaDriveApi(params: {
  rootFolderId: string;
  userFolderId: string;
  persona: PersonaRow;
  bitacoraName: string;
}): Promise<DriveCreationResult> {
  const writeToken = await getGoogleAccessToken(GOOGLE_WRITE_SCOPES);

  let targetUserFolderId = params.userFolderId;
  if (!targetUserFolderId) {
    const userFolder = await createDriveItem({
      name: `${params.persona.codigo} - ${params.persona.nombre}`.slice(0, 120),
      mimeType: MIME_FOLDER,
      parentId: params.rootFolderId,
      token: writeToken,
    });
    targetUserFolderId = userFolder.id;
  }

  const bitacoraFolder = await createDriveItem({
    name: params.bitacoraName,
    mimeType: MIME_FOLDER,
    parentId: targetUserFolderId,
    token: writeToken,
  });

  const createdDoc = await createDriveItem({
    name: params.bitacoraName,
    mimeType: MIME_DOC,
    parentId: bitacoraFolder.id,
    token: writeToken,
  });

  return {
    userFolderId: targetUserFolderId,
    bitacoraFolderId: bitacoraFolder.id,
    docId: createdDoc.id,
    docUrl: normalizeDocUrl(createdDoc.id, createdDoc.webViewLink),
  };
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

    let body: CreateDriveBitacoraBody;
    try {
      body = await req.json() as CreateDriveBitacoraBody;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    if (typeof body.persona_id !== 'number' || !Number.isInteger(body.persona_id) || body.persona_id <= 0) {
      return errorResponse('persona_id válido es obligatorio.');
    }

    const titulo = (body.titulo || '').trim();
    if (!titulo) {
      return errorResponse('El nombre de la bitácora es obligatorio.');
    }
    if (titulo.length > 160) {
      return errorResponse('El nombre de la bitácora no debe superar 160 caracteres.');
    }

    const { data: personaData, error: personaErr } = await adminClient
      .from('personas')
      .select('id, codigo, nombre, drive_folder_id')
      .eq('id', body.persona_id)
      .maybeSingle();

    if (personaErr) {
      return errorResponse(`Error consultando usuario: ${personaErr.message}`, 500);
    }
    if (!personaData) {
      return errorResponse('Usuario no encontrado.', 404);
    }

    const persona = personaData as PersonaRow;
    const rootFolderId = normalizeFolderId(Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID') || '');
    let userFolderId = normalizeFolderId(persona.drive_folder_id || '');
    let readonlyToken = '';

    // Intentar obtener token de lectura y resolver carpeta del usuario desde la raíz si aún no tiene ID
    try {
      readonlyToken = await getGoogleAccessToken();
      if (!userFolderId && rootFolderId) {
        const rootChildren = await listFolderChildren(rootFolderId, readonlyToken);
        const folders = rootChildren.filter((item) => item.mimeType === MIME_FOLDER);
        const matched = findMatchingUserFolder(folders, persona);
        if (matched) {
          userFolderId = matched.id;
        }
      }
    } catch {
      // Si la Service Account aún no puede leer o no existe carpeta previa, continúa al puente configurado
    }

    if (!userFolderId && !rootFolderId) {
      return errorResponse(
        'Este usuario no tiene ID de carpeta en Drive y tampoco hay GOOGLE_DRIVE_ROOT_FOLDER_ID configurado en Supabase.',
        400,
      );
    }

    const webhookUrl = (Deno.env.get('GOOGLE_DRIVE_WEBHOOK_URL') || '').trim();
    const webhookSecret = (Deno.env.get('GOOGLE_DRIVE_WEBHOOK_SECRET') || '').trim();
    if (webhookUrl && !webhookSecret) {
      return errorResponse(
        'Falta configurar GOOGLE_DRIVE_WEBHOOK_SECRET junto con GOOGLE_DRIVE_WEBHOOK_URL en Supabase Secrets.',
        500,
      );
    }

    const created = webhookUrl
      ? await createViaAppsScript({
          webhookUrl,
          webhookSecret,
          rootFolderId,
          userFolderId,
          persona,
          bitacoraName: titulo,
        })
      : await createViaDriveApi({
          rootFolderId,
          userFolderId,
          persona,
          bitacoraName: titulo,
        });

    const finalUserFolderId = created.userFolderId || userFolderId;
    const userFolderLinked = Boolean(finalUserFolderId && finalUserFolderId !== persona.drive_folder_id);
    if (userFolderLinked) {
      await adminClient
        .from('personas')
        .update({ drive_folder_id: finalUserFolderId })
        .eq('id', persona.id);
    }

    let finalDocUrl = created.docUrl;
    let driveModifiedTime: string | null = new Date().toISOString();
    let driveRevisionId = '';
    let estadoSync = 'sincronizada';
    let warning: string | undefined;

    if (readonlyToken) {
      try {
        const meta = await getFileMetadata(created.docId, readonlyToken);
        finalDocUrl = normalizeDocUrl(created.docId, meta.webViewLink || finalDocUrl);
        driveModifiedTime = meta.modifiedTime ?? driveModifiedTime;
        driveRevisionId = meta.headRevisionId ?? '';
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === 'sin_permiso') {
          estadoSync = 'sin_permiso';
          warning =
            'Se creó la bitácora en Drive, pero la Service Account no tiene permiso de lectura sobre la carpeta del usuario. Verifica que la carpeta esté dentro de la carpeta raíz compartida.';
        }
      }
    }

    const { data: topOrder } = await adminClient
      .from('bitacoras')
      .select('orden')
      .eq('persona_id', persona.id)
      .order('orden', { ascending: false })
      .limit(1);

    const nextOrder = typeof topOrder?.[0]?.orden === 'number' ? topOrder[0].orden + 1 : 0;

    const { data: bitacora, error: insertErr } = await adminClient
      .from('bitacoras')
      .insert({
        persona_id: persona.id,
        titulo,
        url_docs: finalDocUrl,
        google_doc_id: created.docId,
        orden: nextOrder,
        drive_modified_time: driveModifiedTime,
        drive_revision_id: driveRevisionId,
        estado_sync: estadoSync,
      })
      .select('id, persona_id, titulo, url_docs, google_doc_id, actualizada, drive_modified_time, estado_sync')
      .single();

    if (insertErr) {
      return errorResponse(`El documento se creó en Drive, pero falló al guardar en Supabase: ${insertErr.message}`, 500);
    }

    await adminClient.from('actividad').insert({
      descripcion: `Se creó en Google Drive la carpeta y bitácora "${titulo}" para ${persona.codigo}.`,
      persona_id: persona.id,
      bitacora_id: bitacora.id,
      actor_id: userId,
      actor_nombre: perfil.nombre || perfil.email,
    });

    return jsonResponse({
      ok: true,
      bitacora,
      drive: {
        user_folder_id: finalUserFolderId,
        bitacora_folder_id: created.bitacoraFolderId,
        doc_id: created.docId,
        doc_url: finalDocUrl,
      },
      user_folder_linked: userFolderLinked,
      ...(warning ? { warning } : {}),
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
    return errorResponse(`Error creando bitácora en Drive: ${(err as Error).message}`, 500);
  }
});
