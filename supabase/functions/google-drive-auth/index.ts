import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { decryptSecret, encryptSecret, signOAuthState, verifyOAuthState } from '../_shared/crypto.ts';
import {
  buildGoogleOAuthAuthorizeUrl,
  exchangeGoogleAuthCode,
  fetchGoogleUserInfo,
  GOOGLE_OAUTH_DRIVE_SCOPES,
  GoogleApiError,
  hasGoogleOAuthConfigured,
  hasServiceAccountConfigured,
  normalizeFolderId,
  revokeGoogleToken,
  type StoredOAuthTokenRow,
} from '../_shared/google.ts';
import { AuthError, getSupabaseAdmin, requireAuthorizedWorker } from '../_shared/supabase.ts';

interface OAuthStatePayload extends Record<string, unknown> {
  userId: string;
  setInstitutional: boolean;
  returnTo: string;
}

function getDefaultAppBaseUrl(): string {
  return (Deno.env.get('APP_BASE_URL') || 'http://127.0.0.1:5173').trim().replace(/\/$/, '');
}

function sanitizeReturnTo(raw?: string): string {
  const fallback = getDefaultAppBaseUrl();
  if (!raw || !raw.trim()) return fallback;
  try {
    const candidate = new URL(raw.trim());
    const allowedHosts = new Set<string>(['localhost', '127.0.0.1']);
    try {
      const appUrl = new URL(fallback);
      allowedHosts.add(appUrl.hostname);
    } catch {
      // mantener hosts locales
    }
    const extraOrigins = (Deno.env.get('ALLOWED_RETURN_ORIGINS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const origin of extraOrigins) {
      try {
        allowedHosts.add(new URL(origin).hostname);
      } catch {
        // ignorar origen malformado
      }
    }

    const isLocal = candidate.hostname === 'localhost' || candidate.hostname === '127.0.0.1';
    if (!isLocal && candidate.protocol !== 'https:') return fallback;
    if (isLocal && candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return fallback;
    if (!allowedHosts.has(candidate.hostname)) return fallback;
    return `${candidate.origin}${candidate.pathname}`.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function redirectToApp(baseUrl: string, params: Record<string, string>): Response {
  const target = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

async function verifyDriveTokenAndEmail(accessToken: string): Promise<{ email: string; sub: string; hasDriveAccess: boolean }> {
  const aboutRes = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (aboutRes.ok) {
    const about = await aboutRes.json() as {
      user?: { displayName?: string; emailAddress?: string; permissionId?: string };
    };
    if (about.user?.emailAddress) {
      return {
        email: about.user.emailAddress,
        sub: about.user.permissionId || '',
        hasDriveAccess: true,
      };
    }
    const info = await fetchGoogleUserInfo(accessToken);
    return { email: info.email, sub: info.sub, hasDriveAccess: true };
  }

  return { email: '', sub: '', hasDriveAccess: false };
}

async function handleOAuthCallbackGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || '').trim();
  const stateParam = (url.searchParams.get('state') || '').trim();
  const googleError = (url.searchParams.get('error') || '').trim();

  let returnTo = getDefaultAppBaseUrl();
  let state: OAuthStatePayload | null = null;
  if (stateParam) {
    try {
      state = await verifyOAuthState<OAuthStatePayload>(stateParam);
      returnTo = sanitizeReturnTo(state.returnTo);
    } catch (err) {
      return redirectToApp(returnTo, {
        drive_oauth_error: (err as Error).message || 'Estado OAuth inválido o expirado.',
      });
    }
  }

  if (googleError) {
    const msg = googleError === 'access_denied'
      ? 'Cancelaste la autorización de Google Drive.'
      : `Google rechazó la autorización (${googleError}).`;
    return redirectToApp(returnTo, { drive_oauth_error: msg });
  }

  if (!code || !state?.userId) {
    return redirectToApp(returnTo, {
      drive_oauth_error: 'Respuesta OAuth de Google incompleta (falta código o estado).',
    });
  }

  try {
    const adminClient = getSupabaseAdmin();
    const { data: perfil, error: perfilErr } = await adminClient
      .from('perfiles')
      .select('id, email, nombre, rol')
      .eq('id', state.userId)
      .maybeSingle();

    if (perfilErr || !perfil || (perfil.rol !== 'admin' && perfil.rol !== 'trabajador')) {
      return redirectToApp(returnTo, {
        drive_oauth_error: 'Tu cuenta no está autorizada para conectar Google Drive.',
      });
    }

    const tokens = await exchangeGoogleAuthCode(code);
    const verified = await verifyDriveTokenAndEmail(tokens.access_token);
    const userInfo = verified.email ? verified : await fetchGoogleUserInfo(tokens.access_token);

    // Determinar si debe quedar como cuenta institucional de sincronización automática
    let shouldSetInstitutional = Boolean(state.setInstitutional && perfil.rol === 'admin');
    if (!shouldSetInstitutional && perfil.rol === 'admin' && tokens.refresh_token) {
      const { data: currentInst } = await adminClient.rpc('srv_get_institutional_google_oauth_token');
      if (!Array.isArray(currentInst) || currentInst.length === 0) {
        shouldSetInstitutional = true;
      }
    }

    const accessEnc = await encryptSecret(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? await encryptSecret(tokens.refresh_token) : '';
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { data: upsertRes, error: upsertErr } = await adminClient.rpc('srv_upsert_google_oauth_token', {
      p_user_id: state.userId,
      p_google_email: userInfo.email,
      p_google_sub: userInfo.sub,
      p_scopes: tokens.scope || GOOGLE_OAUTH_DRIVE_SCOPES,
      p_access_token_enc: accessEnc,
      p_refresh_token_enc: refreshEnc,
      p_expires_at: expiresAt,
      p_set_institutional: shouldSetInstitutional,
    });

    if (upsertErr) {
      return redirectToApp(returnTo, {
        drive_oauth_error: `Error guardando conexión de Google Drive: ${upsertErr.message}`,
      });
    }

    const isInst = Boolean((upsertRes as { is_institutional?: boolean } | null)?.is_institutional);
    await adminClient.from('actividad').insert({
      descripcion: isInst
        ? `Conectó Google Drive institucional (${userInfo.email || perfil.email}) para sincronización automática.`
        : `Conectó su cuenta Google Drive (${userInfo.email || perfil.email}).`,
      actor_id: state.userId,
      actor_nombre: perfil.nombre || perfil.email,
    });

    return redirectToApp(returnTo, {
      drive_connected: '1',
      drive_email: userInfo.email || '',
      drive_inst: isInst ? '1' : '0',
    });
  } catch (err) {
    return redirectToApp(returnTo, {
      drive_oauth_error: (err as Error).message || 'No se pudo completar la conexión con Google Drive.',
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method === 'GET') {
    return await handleOAuthCallbackGet(req);
  }

  if (req.method !== 'POST') {
    return errorResponse('Método no permitido.', 405);
  }

  try {
    const { userId, perfil, adminClient } = await requireAuthorizedWorker(req);

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return errorResponse('Cuerpo JSON inválido.');
    }

    const action = typeof body.action === 'string' ? body.action.trim() : '';

    if (action === 'status') {
      const { data: ownRow } = await adminClient.rpc('srv_get_google_oauth_token', { p_user_id: userId });
      const { data: instRow } = await adminClient.rpc('srv_get_institutional_google_oauth_token');
      const own = Array.isArray(ownRow) && ownRow.length > 0 ? (ownRow[0] as StoredOAuthTokenRow) : null;
      const inst = Array.isArray(instRow) && instRow.length > 0 ? (instRow[0] as StoredOAuthTokenRow) : null;

      return jsonResponse({
        ok: true,
        oauth_configured: hasGoogleOAuthConfigured(),
        service_account_configured: hasServiceAccountConfigured(),
        conectado: own?.status === 'conectado',
        google_email: own?.google_email || '',
        status: own?.status || 'desconectado',
        es_institucional: Boolean(own?.is_institutional),
        tiene_refresh_token: Boolean(own?.refresh_token_enc),
        last_error: own?.last_error || '',
        updated_at: own?.updated_at || null,
        institucional: {
          conectado: inst?.status === 'conectado',
          google_email: inst?.google_email || '',
          status: inst?.status || 'sin_configurar',
          es_propia: Boolean(inst && inst.user_id === userId),
          last_error: inst?.last_error || '',
          updated_at: inst?.updated_at || null,
        },
      });
    }

    if (action === 'save-provider-tokens') {
      const providerToken = typeof body.provider_token === 'string' ? body.provider_token.trim() : '';
      const providerRefresh = typeof body.provider_refresh_token === 'string'
        ? body.provider_refresh_token.trim()
        : '';

      if (!providerToken) {
        return errorResponse('Falta provider_token de la sesión de Google.', 400);
      }

      const verified = await verifyDriveTokenAndEmail(providerToken);
      if (!verified.hasDriveAccess) {
        return jsonResponse({
          ok: false,
          has_drive_scope: false,
          message: 'La sesión Google actual no incluye permisos de Google Drive.',
        });
      }

      let shouldSetInstitutional = false;
      if (perfil.rol === 'admin' && providerRefresh) {
        const { data: currentInst } = await adminClient.rpc('srv_get_institutional_google_oauth_token');
        if (!Array.isArray(currentInst) || currentInst.length === 0) {
          shouldSetInstitutional = true;
        }
      }

      const accessEnc = await encryptSecret(providerToken);
      const refreshEnc = providerRefresh ? await encryptSecret(providerRefresh) : '';
      // Los access_token de Google duran ~55-60 minutos
      const expiresAt = new Date(Date.now() + 50 * 60_000).toISOString();

      const { data: upsertRes, error: upsertErr } = await adminClient.rpc('srv_upsert_google_oauth_token', {
        p_user_id: userId,
        p_google_email: verified.email || perfil.email,
        p_google_sub: verified.sub,
        p_scopes: GOOGLE_OAUTH_DRIVE_SCOPES,
        p_access_token_enc: accessEnc,
        p_refresh_token_enc: refreshEnc,
        p_expires_at: expiresAt,
        p_set_institutional: shouldSetInstitutional,
      });

      if (upsertErr) {
        return errorResponse(`No se pudo guardar la conexión Google Drive: ${upsertErr.message}`, 500);
      }

      const resObj = (upsertRes ?? {}) as { is_institutional?: boolean; tiene_refresh_token?: boolean };
      return jsonResponse({
        ok: true,
        has_drive_scope: true,
        google_email: verified.email || perfil.email,
        es_institucional: Boolean(resObj.is_institutional),
        tiene_refresh_token: Boolean(resObj.tiene_refresh_token),
      });
    }

    if (action === 'start-oauth') {
      const setInstitutional = Boolean(body.set_institutional);
      if (setInstitutional && perfil.rol !== 'admin') {
        return errorResponse('Solo un administrador puede configurar la conexión institucional de Drive.', 403);
      }

      const returnTo = sanitizeReturnTo(typeof body.return_to === 'string' ? body.return_to : undefined);
      const state = await signOAuthState({
        userId,
        setInstitutional,
        returnTo,
      });

      const authUrl = buildGoogleOAuthAuthorizeUrl({
        state,
        loginHint: perfil.email,
        prompt: 'consent select_account',
      });

      return jsonResponse({ ok: true, auth_url: authUrl });
    }

    if (action === 'set-institutional') {
      if (perfil.rol !== 'admin') {
        return errorResponse('Solo un administrador puede designar la cuenta institucional.', 403);
      }
      const { data, error } = await adminClient.rpc('srv_set_institutional_google_oauth', {
        p_user_id: userId,
      });
      if (error) {
        return errorResponse(`Error configurando cuenta institucional: ${error.message}`, 500);
      }
      const result = (data ?? {}) as { ok?: boolean; error?: string; google_email?: string };
      if (!result.ok) {
        return errorResponse(result.error || 'No se pudo activar como cuenta institucional.', 400);
      }

      await adminClient.from('actividad').insert({
        descripcion: `Designó ${result.google_email || perfil.email} como cuenta Google Drive institucional para sincronización automática.`,
        actor_id: userId,
        actor_nombre: perfil.nombre || perfil.email,
      });

      return jsonResponse({ ok: true, google_email: result.google_email || '' });
    }

    if (action === 'set-root-folder') {
      if (perfil.rol !== 'admin') {
        return errorResponse('Solo un administrador puede configurar la carpeta raíz de CEMIPRE.', 403);
      }
      const rawFolder = typeof body.root_folder_id === 'string' ? body.root_folder_id.trim() : '';
      const folderId = rawFolder ? normalizeFolderId(rawFolder) : '';
      if (rawFolder && !folderId) {
        return errorResponse('El ID o enlace de carpeta raíz no es válido.', 400);
      }
      const folderName = typeof body.root_folder_name === 'string'
        ? body.root_folder_name.trim().slice(0, 160)
        : '';

      const { error: updErr } = await adminClient.from('drive_sync_state').upsert({
        id: 'global',
        root_folder_id: folderId,
        root_folder_name: folderId ? folderName : '',
        actualizado: new Date().toISOString(),
      });
      if (updErr) {
        return errorResponse(`Error guardando carpeta raíz: ${updErr.message}`, 500);
      }

      await adminClient.from('actividad').insert({
        descripcion: folderId
          ? `Configuró la carpeta raíz automática de Drive: "${folderName || folderId}".`
          : 'Desvinculó la carpeta raíz automática de Google Drive.',
        actor_id: userId,
        actor_nombre: perfil.nombre || perfil.email,
      });

      return jsonResponse({
        ok: true,
        root_folder_id: folderId,
        root_folder_name: folderId ? folderName : '',
      });
    }

    if (action === 'set-auto-sync') {
      if (perfil.rol !== 'admin') {
        return errorResponse('Solo un administrador puede cambiar la configuración de sincronización automática.', 403);
      }
      const enabled = body.enabled !== false;
      const rawInterval = Number(body.interval_min ?? 5);
      const intervalMin = Number.isFinite(rawInterval)
        ? Math.min(60, Math.max(2, Math.round(rawInterval)))
        : 5;

      const { error: updErr } = await adminClient.from('drive_sync_state').upsert({
        id: 'global',
        auto_sync_enabled: enabled,
        auto_sync_interval_min: intervalMin,
        actualizado: new Date().toISOString(),
      });
      if (updErr) {
        return errorResponse(`Error guardando preferencia de auto-sync: ${updErr.message}`, 500);
      }

      return jsonResponse({
        ok: true,
        auto_sync_enabled: enabled,
        auto_sync_interval_min: intervalMin,
      });
    }

    if (action === 'disconnect') {
      const { data: ownRows } = await adminClient.rpc('srv_get_google_oauth_token', { p_user_id: userId });
      const own = Array.isArray(ownRows) && ownRows.length > 0 ? (ownRows[0] as StoredOAuthTokenRow) : null;
      if (own?.refresh_token_enc) {
        try {
          const plain = await decryptSecret(own.refresh_token_enc);
          await revokeGoogleToken(plain);
        } catch {
          // continuar con limpieza local
        }
      } else if (own?.access_token_enc) {
        try {
          const plain = await decryptSecret(own.access_token_enc);
          await revokeGoogleToken(plain);
        } catch {
          // continuar con limpieza local
        }
      }

      const { error: delErr } = await adminClient.rpc('srv_delete_google_oauth_token', { p_user_id: userId });
      if (delErr) {
        return errorResponse(`Error desconectando Google Drive: ${delErr.message}`, 500);
      }

      await adminClient.from('actividad').insert({
        descripcion: `Desconectó su cuenta Google Drive (${own?.google_email || perfil.email}).`,
        actor_id: userId,
        actor_nombre: perfil.nombre || perfil.email,
      });

      return jsonResponse({ ok: true });
    }

    return errorResponse('Acción no soportada en google-drive-auth.', 400);
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.status);
    }
    if (err instanceof GoogleApiError) {
      return errorResponse(err.message, err.status >= 400 && err.status < 600 ? err.status : 502, {
        code: err.code,
      });
    }
    return errorResponse(`Error en google-drive-auth: ${(err as Error).message}`, 500);
  }
});
