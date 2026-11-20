import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import {
  browseDriveItems,
  getUserDriveToken,
  GoogleApiError,
  normalizeDocUrl,
  normalizeFolderId,
} from '../_shared/google.ts';
import { AuthError, requireAuthorizedWorker } from '../_shared/supabase.ts';

interface BrowseRequestBody {
  section?: 'my_drive' | 'shared_with_me' | 'shared_drives' | 'search';
  folder_id?: string;
  drive_id?: string;
  query?: string;
  mode?: 'folder' | 'docs' | 'all';
  page_token?: string;
}

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_DOC = 'application/vnd.google-apps.document';
const MIME_SHORTCUT = 'application/vnd.google-apps.shortcut';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido. Usa POST.', 405);
  }

  try {
    const { userId, adminClient } = await requireAuthorizedWorker(req);

    let body: BrowseRequestBody = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as BrowseRequestBody;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    // Seguridad estricta: el explorador usa EXCLUSIVAMENTE el token OAuth del propio trabajador.
    const userToken = await getUserDriveToken(adminClient, userId);
    if (!userToken) {
      return errorResponse(
        'Conecta tu cuenta de Google Drive para explorar carpetas y bitácoras.',
        401,
        { code: 'reconexion_requerida' },
      );
    }

    const section = body.section === 'shared_with_me'
      || body.section === 'shared_drives'
      || body.section === 'search'
      ? body.section
      : 'my_drive';

    const mode = body.mode === 'folder' || body.mode === 'docs' ? body.mode : 'all';
    const folderId = body.folder_id ? normalizeFolderId(body.folder_id) : '';
    const driveId = body.drive_id ? normalizeFolderId(body.drive_id) : '';
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
    const pageToken = typeof body.page_token === 'string' ? body.page_token.trim() : '';

    const result = await browseDriveItems({
      token: userToken.token,
      section,
      folderId,
      driveId,
      query,
      mode,
      pageToken,
    });

    const items = result.items.map((item) => {
      const isShortcut = item.mimeType === MIME_SHORTCUT;
      const effectiveMime = isShortcut ? (item.shortcutDetails?.targetMimeType || '') : item.mimeType;
      const effectiveId = isShortcut && item.shortcutDetails?.targetId
        ? item.shortcutDetails.targetId
        : item.id;
      const isFolder = effectiveMime === MIME_FOLDER;
      const isDoc = effectiveMime === MIME_DOC;

      return {
        id: effectiveId,
        shortcut_id: isShortcut ? item.id : null,
        name: item.name,
        kind: isFolder ? 'folder' : isDoc ? 'doc' : 'other',
        mime_type: effectiveMime,
        modified_time: item.modifiedTime || null,
        head_revision_id: item.headRevisionId || '',
        url: isDoc ? normalizeDocUrl(effectiveId, item.webViewLink) : (item.webViewLink || ''),
        drive_id: item.driveId || driveId || '',
        owner: item.owners?.[0]?.displayName || item.owners?.[0]?.emailAddress || '',
      };
    });

    return jsonResponse({
      ok: true,
      google_email: userToken.email || '',
      section,
      mode,
      current_folder: result.currentFolder,
      items,
      next_page_token: result.nextPageToken,
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
    return errorResponse(`Error explorando Google Drive: ${(err as Error).message}`, 500);
  }
});
