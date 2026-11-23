/**
 * Conector compartido para Google Drive y Google Docs en Deno.
 * Soporta:
 *  1) OAuth 2.0 de cuentas Google reales (trabajadores y cuenta institucional CEMIPRE)
 *     con tokens cifrados en `private.google_oauth_tokens` y refresco automático.
 *  2) Service Account RS256 (Web Crypto API nativa) como respaldo opcional.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret, encryptSecret } from './crypto.ts';

export const GOOGLE_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');
export const GOOGLE_WRITE_SCOPES = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const GOOGLE_OAUTH_DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive',
  GOOGLE_CALENDAR_SCOPE,
].join(' ');

export function hasCalendarScope(scopes?: string | null): boolean {
  return typeof scopes === 'string' && scopes.toLowerCase().includes('calendar');
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;

export function normalizeDocUrl(fileId: string, webViewLink?: string): string {
  if (webViewLink && webViewLink.startsWith('https://docs.google.com/document/d/')) {
    return webViewLink;
  }
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

export function normalizeFolderId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com') return '';
      const pathMatch = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/);
      if (pathMatch) return pathMatch[1];
      if (parsed.pathname === '/open') {
        const openId = (parsed.searchParams.get('id') || '').trim();
        return DRIVE_ID_REGEX.test(openId) ? openId : '';
      }
      return '';
    } catch {
      return '';
    }
  }
  const clean = trimmed
    .replace(/^(?:\/?drive\/(?:u\/\d+\/)?)?\/?folders\//i, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')
    .trim();
  return DRIVE_ID_REGEX.test(clean) ? clean : '';
}

export function parseFolderIdentity(folderName: string, folderId: string): { codigo: string; nombre: string } {
  const trimmed = folderName.trim();
  const match = trimmed.match(/^([A-Za-z]{2,10}-\d{1,6})(?:\s*[-–|:]\s*(.+))?$/);
  if (match) {
    return {
      codigo: match[1].toUpperCase(),
      nombre: (match[2] || match[1]).trim().slice(0, 120),
    };
  }
  return {
    codigo: `DRV-${folderId.slice(0, 6).toUpperCase()}`,
    nombre: trimmed.slice(0, 120) || 'Usuario Drive',
  };
}

export type DriveErrorCode =
  | 'sin_permiso'
  | 'no_encontrada'
  | 'configuracion'
  | 'error_api'
  | 'reconexion_requerida';

export class GoogleApiError extends Error {
  status: number;
  code: DriveErrorCode;
  constructor(message: string, status: number, code: DriveErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  headRevisionId?: string;
  webViewLink?: string;
  trashed?: boolean;
  parents?: string[];
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  driveId?: string;
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

export interface DriveChangeItem {
  fileId?: string;
  removed?: boolean;
  time?: string;
  file?: DriveFileMeta;
}

export interface StoredOAuthTokenRow {
  user_id: string;
  google_email: string;
  google_sub: string;
  scopes: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string | null;
  is_institutional: boolean;
  status: 'conectado' | 'requiere_reconexion' | 'desconectado';
  last_error: string;
  updated_at: string;
}

export interface ResolvedDriveToken {
  token: string;
  source: 'user_oauth' | 'institutional_oauth' | 'service_account';
  email?: string;
  userId?: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const cachedServiceTokens = new Map<string, { token: string; expiresAt: number }>();

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function hasServiceAccountConfigured(): boolean {
  const rawJson = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '').trim();
  if (rawJson) return true;
  const email = (Deno.env.get('GOOGLE_CLIENT_EMAIL') || '').trim();
  const key = (Deno.env.get('GOOGLE_PRIVATE_KEY') || '').trim();
  return Boolean(email && key);
}

export function hasGoogleOAuthConfigured(): boolean {
  const clientId = (Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '').trim();
  return Boolean(clientId && clientSecret);
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = (Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '').trim();
  const explicitRedirect = (Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') || '').trim();
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim().replace(/\/$/, '');
  const redirectUri = explicitRedirect || (supabaseUrl ? `${supabaseUrl}/functions/v1/google-drive-auth` : '');

  if (!clientId || !clientSecret) {
    throw new GoogleApiError(
      'Faltan GOOGLE_OAUTH_CLIENT_ID o GOOGLE_OAUTH_CLIENT_SECRET en Supabase Secrets.',
      500,
      'configuracion',
    );
  }
  if (!redirectUri) {
    throw new GoogleApiError(
      'No se pudo determinar GOOGLE_OAUTH_REDIRECT_URI para el flujo OAuth de Google.',
      500,
      'configuracion',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleOAuthAuthorizeUrl(params: {
  state: string;
  loginHint?: string;
  prompt?: string;
  scopes?: string;
}): string {
  const cfg = getGoogleOAuthConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes || GOOGLE_OAUTH_DRIVE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', params.prompt || 'consent select_account');
  url.searchParams.set('state', params.state);
  if (params.loginHint) {
    url.searchParams.set('login_hint', params.loginHint);
  }
  return url.toString();
}

export async function exchangeGoogleAuthCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}> {
  const cfg = getGoogleOAuthConfig();
  const response = await fetch(DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new GoogleApiError(
      `Error intercambiando código OAuth de Google (${response.status}): ${text.slice(0, 220)}`,
      response.status,
      'configuracion',
    );
  }

  const data = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new GoogleApiError('Google OAuth no devolvió access_token.', 502, 'error_api');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: Number(data.expires_in ?? 3600),
    scope: data.scope || GOOGLE_OAUTH_DRIVE_SCOPES,
  };
}

export async function refreshGoogleOAuthToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope?: string;
}> {
  const cfg = getGoogleOAuthConfig();
  const response = await fetch(DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    let errCode = '';
    try {
      const parsed = JSON.parse(text) as { error?: string };
      errCode = parsed.error || '';
    } catch {
      // mantener errCode vacío
    }
    if (errCode === 'invalid_grant' || response.status === 400 || response.status === 401) {
      throw new GoogleApiError(
        'La autorización de Google Drive expiró o fue revocada. Vuelve a conectar tu cuenta.',
        401,
        'reconexion_requerida',
      );
    }
    throw new GoogleApiError(
      `No se pudo renovar el token de Google Drive (${response.status}): ${text.slice(0, 200)}`,
      response.status,
      'error_api',
    );
  }

  const data = JSON.parse(text) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new GoogleApiError('Google no devolvió access_token al renovar.', 502, 'error_api');
  }
  return {
    access_token: data.access_token,
    expires_in: Number(data.expires_in ?? 3600),
    scope: data.scope,
  };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  sub: string;
  name: string;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Fallback a Drive about.get si userinfo no tuviera scope openid
    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!aboutRes.ok) {
      throw new GoogleApiError(
        'El token de Google no tiene permisos válidos para Google Drive.',
        aboutRes.status,
        'reconexion_requerida',
      );
    }
    const about = await aboutRes.json() as {
      user?: { displayName?: string; emailAddress?: string; permissionId?: string };
    };
    return {
      email: about.user?.emailAddress || '',
      sub: about.user?.permissionId || '',
      name: about.user?.displayName || '',
    };
  }
  const info = await res.json() as { email?: string; sub?: string; name?: string };
  return {
    email: info.email || '',
    sub: info.sub || '',
    name: info.name || '',
  };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Revocación best-effort
  }
}

async function getFreshOAuthTokenForRow(
  adminClient: SupabaseClient,
  row: StoredOAuthTokenRow,
): Promise<string> {
  if (row.status === 'desconectado') {
    throw new GoogleApiError('La cuenta Google Drive está desconectada.', 401, 'reconexion_requerida');
  }

  const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token_enc && expiresMs > Date.now() + 90_000) {
    try {
      const decrypted = await decryptSecret(row.access_token_enc);
      if (decrypted) return decrypted;
    } catch {
      // Si falla descifrado de access_token, intentar renovar con refresh_token
    }
  }

  if (!row.refresh_token_enc) {
    await adminClient.rpc('srv_mark_google_oauth_status', {
      p_user_id: row.user_id,
      p_status: 'requiere_reconexion',
      p_last_error: 'Sesión Google expirada (sin refresh_token offline). Reconecta tu cuenta Google Drive.',
      p_access_token_enc: '',
      p_expires_at: null,
    });
    throw new GoogleApiError(
      'Tu sesión de Google Drive expiró. Vuelve a conectar tu cuenta para continuar.',
      401,
      'reconexion_requerida',
    );
  }

  let refreshToken = '';
  try {
    refreshToken = await decryptSecret(row.refresh_token_enc);
  } catch {
    await adminClient.rpc('srv_mark_google_oauth_status', {
      p_user_id: row.user_id,
      p_status: 'requiere_reconexion',
      p_last_error: 'No se pudo descifrar el token guardado. Reconecta tu cuenta Google Drive.',
      p_access_token_enc: '',
      p_expires_at: null,
    });
    throw new GoogleApiError(
      'No se pudo leer la credencial de Google Drive. Reconecta tu cuenta Google.',
      401,
      'reconexion_requerida',
    );
  }

  try {
    const refreshed = await refreshGoogleOAuthToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    const newAccessEnc = await encryptSecret(refreshed.access_token);
    await adminClient.rpc('srv_mark_google_oauth_status', {
      p_user_id: row.user_id,
      p_status: 'conectado',
      p_last_error: '',
      p_access_token_enc: newAccessEnc,
      p_expires_at: newExpiresAt,
    });
    return refreshed.access_token;
  } catch (err) {
    if (err instanceof GoogleApiError && err.code === 'reconexion_requerida') {
      await adminClient.rpc('srv_mark_google_oauth_status', {
        p_user_id: row.user_id,
        p_status: 'requiere_reconexion',
        p_last_error: err.message,
        p_access_token_enc: '',
        p_expires_at: null,
      });
    }
    throw err;
  }
}

export async function getUserDriveToken(
  adminClient: SupabaseClient,
  userId: string,
): Promise<ResolvedDriveToken | null> {
  if (!userId) return null;
  const { data, error } = await adminClient.rpc('srv_get_google_oauth_token', {
    p_user_id: userId,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as StoredOAuthTokenRow;
  const token = await getFreshOAuthTokenForRow(adminClient, row);
  return {
    token,
    source: row.is_institutional ? 'institutional_oauth' : 'user_oauth',
    email: row.google_email,
    userId: row.user_id,
  };
}

export async function getInstitutionalDriveToken(
  adminClient: SupabaseClient,
): Promise<ResolvedDriveToken | null> {
  const { data, error } = await adminClient.rpc('srv_get_institutional_google_oauth_token');
  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const row = data[0] as StoredOAuthTokenRow;
  const token = await getFreshOAuthTokenForRow(adminClient, row);
  return {
    token,
    source: 'institutional_oauth',
    email: row.google_email,
    userId: row.user_id,
  };
}

export async function resolveDriveTokenCandidates(
  adminClient: SupabaseClient,
  options: {
    userId?: string | null;
    preferInstitutional?: boolean;
    includeServiceAccount?: boolean;
    serviceAccountScopes?: string;
  } = {},
): Promise<{ candidates: ResolvedDriveToken[]; reconnectNeeded: boolean; lastAuthError: string }> {
  const candidates: ResolvedDriveToken[] = [];
  const seenKeys = new Set<string>();
  let reconnectNeeded = false;
  let lastAuthError = '';

  const tryAdd = async (label: string, loader: () => Promise<ResolvedDriveToken | null>) => {
    try {
      const resolved = await loader();
      if (!resolved) return;
      const dedupeKey = resolved.userId ? `user:${resolved.userId}` : `source:${resolved.source}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      candidates.push(resolved);
    } catch (err) {
      if (err instanceof GoogleApiError && err.code === 'reconexion_requerida') {
        reconnectNeeded = true;
        lastAuthError = err.message;
      } else if (!lastAuthError) {
        lastAuthError = `${label}: ${(err as Error).message}`;
      }
    }
  };

  const uid = options.userId;
  if (options.preferInstitutional) {
    await tryAdd('institucional', () => getInstitutionalDriveToken(adminClient));
    if (uid) {
      await tryAdd('usuario', () => getUserDriveToken(adminClient, uid));
    }
  } else {
    if (uid) {
      await tryAdd('usuario', () => getUserDriveToken(adminClient, uid));
    }
    await tryAdd('institucional', () => getInstitutionalDriveToken(adminClient));
  }

  if (options.includeServiceAccount !== false && hasServiceAccountConfigured()) {
    await tryAdd('service_account', async () => {
      const token = await getGoogleAccessToken(options.serviceAccountScopes || GOOGLE_READONLY_SCOPES);
      return { token, source: 'service_account' };
    });
  }

  return { candidates, reconnectNeeded, lastAuthError };
}

export async function withDriveTokenFallback<T>(
  candidates: ResolvedDriveToken[],
  operation: (candidate: ResolvedDriveToken) => Promise<T>,
): Promise<{ result: T; used: ResolvedDriveToken }> {
  if (candidates.length === 0) {
    throw new GoogleApiError(
      'No hay ninguna cuenta Google Drive conectada ni Service Account configurada.',
      400,
      'configuracion',
    );
  }
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const result = await operation(candidate);
      return { result, used: candidate };
    } catch (err) {
      lastErr = err;
      if (
        err instanceof GoogleApiError
        && (err.code === 'sin_permiso' || err.code === 'no_encontrada' || err.code === 'reconexion_requerida')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function loadServiceAccountCredentials(): ServiceAccountCredentials {
  const rawJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (rawJson && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson) as Partial<ServiceAccountCredentials>;
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('Faltan client_email o private_key en GOOGLE_SERVICE_ACCOUNT_JSON.');
      }
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        token_uri: parsed.token_uri || DEFAULT_TOKEN_URI,
      };
    } catch (err) {
      throw new GoogleApiError(
        `Credencial GOOGLE_SERVICE_ACCOUNT_JSON inválida: ${(err as Error).message}`,
        500,
        'configuracion',
      );
    }
  }

  const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY');
  if (clientEmail && privateKey) {
    return { client_email: clientEmail, private_key: privateKey, token_uri: DEFAULT_TOKEN_URI };
  }

  throw new GoogleApiError(
    'No está configurada la Service Account de Google (GOOGLE_SERVICE_ACCOUNT_JSON).',
    500,
    'configuracion',
  );
}

async function createSignedJwt(creds: ServiceAccountCredentials, scopes: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = creds.token_uri || DEFAULT_TOKEN_URI;

  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    iss: creds.client_email,
    scope: scopes,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(creds.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(scopes = GOOGLE_READONLY_SCOPES): Promise<string> {
  const now = Date.now();
  const cached = cachedServiceTokens.get(scopes);
  if (cached && cached.expiresAt - 60_000 > now) {
    return cached.token;
  }

  const creds = loadServiceAccountCredentials();
  const assertion = await createSignedJwt(creds, scopes);
  const tokenUri = creds.token_uri || DEFAULT_TOKEN_URI;

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GoogleApiError(
      `No se pudo obtener token OAuth de Google (${response.status}): ${detail.slice(0, 200)}`,
      response.status,
      'configuracion',
    );
  }

  const data = await response.json() as { access_token: string; expires_in?: number };
  cachedServiceTokens.set(scopes, {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

function classifyGoogleHttpError(status: number, context: string): GoogleApiError {
  if (status === 401 || status === 403) {
    return new GoogleApiError(
      `Sin permiso de lectura en Google Drive (${context}). Verifica que la cuenta Google conectada tenga acceso al archivo o carpeta.`,
      status,
      'sin_permiso',
    );
  }
  if (status === 404) {
    return new GoogleApiError(
      `Documento o carpeta no encontrada en Google Drive (${context}).`,
      status,
      'no_encontrada',
    );
  }
  return new GoogleApiError(`Error ${status} consultando Google (${context}).`, status, 'error_api');
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDriveWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, init);
    const retryable = response.status === 429 || (response.status >= 500 && response.status <= 504);
    if (!retryable || attempt === maxAttempts) {
      return response;
    }
    const retryAfterSec = Number(response.headers.get('retry-after') || '0');
    await response.body?.cancel();
    const waitMs = retryAfterSec > 0 && retryAfterSec <= 5
      ? retryAfterSec * 1000
      : 400 * attempt;
    await sleepMs(waitMs);
  }
  return await fetch(url, init);
}

export async function getFileMetadata(fileId: string, token: string): Promise<DriveFileMeta> {
  const fields = 'id,name,mimeType,modifiedTime,headRevisionId,webViewLink,trashed,parents,driveId,shortcutDetails';
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const response = await fetchDriveWithRetry(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw classifyGoogleHttpError(response.status, fileId);
  }
  return await response.json() as DriveFileMeta;
}

function extractParagraphText(elements: Array<{ textRun?: { content?: string } }> = []): string {
  return elements.map((el) => el.textRun?.content ?? '').join('');
}

function extractStructuralElements(content: Array<Record<string, unknown>> = []): string {
  const parts: string[] = [];
  for (const item of content) {
    const paragraph = item.paragraph as { elements?: Array<{ textRun?: { content?: string } }> } | undefined;
    if (paragraph?.elements) {
      parts.push(extractParagraphText(paragraph.elements));
    }
    const table = item.table as {
      tableRows?: Array<{ tableCells?: Array<{ content?: Array<Record<string, unknown>> }> }>;
    } | undefined;
    if (table?.tableRows) {
      for (const row of table.tableRows) {
        const rowCells = (row.tableCells ?? []).map((cell) =>
          extractStructuralElements(cell.content ?? []).trim()
        );
        parts.push(`${rowCells.join(' | ')}\n`);
      }
    }
  }
  return parts.join('');
}

async function readDocViaDocsApi(fileId: string, token: string): Promise<string> {
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}?includeTabsContent=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw classifyGoogleHttpError(response.status, fileId);
  }
  const doc = await response.json() as {
    body?: { content?: Array<Record<string, unknown>> };
    tabs?: Array<{ documentTab?: { body?: { content?: Array<Record<string, unknown>> } } }>;
  };

  if (doc.tabs && doc.tabs.length > 0) {
    return doc.tabs
      .map((tab) => extractStructuralElements(tab.documentTab?.body?.content ?? []))
      .join('\n')
      .trim();
  }
  return extractStructuralElements(doc.body?.content ?? []).trim();
}

export async function exportDocAsText(fileId: string, token: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok) {
    return (await response.text()).replace(/\uFEFF/g, '').trim();
  }

  if (response.status === 400) {
    try {
      return await readDocViaDocsApi(fileId, token);
    } catch {
      const mediaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (mediaRes.ok) {
        return (await mediaRes.text()).replace(/\uFEFF/g, '').trim();
      }
    }
  }

  throw classifyGoogleHttpError(response.status, fileId);
}

export async function listFolderChildren(folderId: string, token: string): Promise<DriveFileMeta[]> {
  const files: DriveFileMeta[] = [];
  let pageToken = '';
  const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const fields = 'nextPageToken,files(id,name,mimeType,modifiedTime,headRevisionId,webViewLink,trashed,parents,shortcutDetails)';

  do {
    const params = new URLSearchParams({
      q: query,
      fields,
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      orderBy: 'folder,name',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetchDriveWithRetry(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw classifyGoogleHttpError(response.status, folderId);
    }
    const payload = await response.json() as { files?: DriveFileMeta[]; nextPageToken?: string };
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);

  return files;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function browseDriveItems(params: {
  token: string;
  section: 'my_drive' | 'shared_with_me' | 'shared_drives' | 'search';
  folderId?: string;
  driveId?: string;
  query?: string;
  mode?: 'folder' | 'docs' | 'all';
  pageToken?: string;
}): Promise<{
  items: DriveFileMeta[];
  nextPageToken: string;
  currentFolder: { id: string; name: string; parents?: string[] } | null;
}> {
  const { token, section, folderId = '', driveId = '', query = '', mode = 'all', pageToken = '' } = params;

  // Listar Unidades Compartidas (Shared Drives) en el nivel superior
  if (section === 'shared_drives' && !folderId) {
    const urlParams = new URLSearchParams({ pageSize: '50' });
    if (pageToken) urlParams.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/drives?${urlParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw classifyGoogleHttpError(res.status, 'shared_drives');
    }
    const payload = await res.json() as {
      drives?: Array<{ id: string; name: string }>;
      nextPageToken?: string;
    };
    const items: DriveFileMeta[] = (payload.drives ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: 'application/vnd.google-apps.folder',
      driveId: d.id,
    }));
    return {
      items,
      nextPageToken: payload.nextPageToken ?? '',
      currentFolder: null,
    };
  }

  const clauses: string[] = ['trashed = false'];
  if (mode === 'folder') {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.folder' or (mimeType = 'application/vnd.google-apps.shortcut'))",
    );
  } else {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.shortcut')",
    );
  }

  const cleanSearch = query.trim();
  if (cleanSearch) {
    clauses.push(`name contains '${escapeDriveQueryValue(cleanSearch)}'`);
  }

  if (folderId) {
    clauses.push(`'${escapeDriveQueryValue(folderId)}' in parents`);
  } else if (section === 'my_drive' && !cleanSearch) {
    clauses.push("'root' in parents");
  } else if (section === 'shared_with_me' && !cleanSearch) {
    clauses.push('sharedWithMe = true');
  }

  const fields = 'nextPageToken,files(id,name,mimeType,modifiedTime,headRevisionId,webViewLink,parents,driveId,owners(displayName,emailAddress),shortcutDetails)';
  const urlParams = new URLSearchParams({
    q: clauses.join(' and '),
    fields,
    pageSize: '60',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    orderBy: cleanSearch ? 'modifiedTime desc,name' : 'folder,name',
  });
  if (driveId) {
    urlParams.set('corpora', 'drive');
    urlParams.set('driveId', driveId);
  }
  if (pageToken) urlParams.set('pageToken', pageToken);

  const [filesRes, folderMeta] = await Promise.all([
    fetch(`https://www.googleapis.com/drive/v3/files?${urlParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    folderId ? getFileMetadata(folderId, token).catch(() => null) : Promise.resolve(null),
  ]);

  if (!filesRes.ok) {
    throw classifyGoogleHttpError(filesRes.status, folderId || section);
  }

  const payload = await filesRes.json() as { files?: DriveFileMeta[]; nextPageToken?: string };
  const rawItems = payload.files ?? [];

  // Filtrar atajos que no apunten a carpeta/doc según el modo pedido
  const filteredItems = rawItems.filter((item) => {
    if (item.mimeType !== 'application/vnd.google-apps.shortcut') return true;
    const targetMime = item.shortcutDetails?.targetMimeType || '';
    if (mode === 'folder') return targetMime === 'application/vnd.google-apps.folder';
    return (
      targetMime === 'application/vnd.google-apps.folder'
      || targetMime === 'application/vnd.google-apps.document'
    );
  });

  return {
    items: filteredItems,
    nextPageToken: payload.nextPageToken ?? '',
    currentFolder: folderMeta
      ? { id: folderMeta.id, name: folderMeta.name, parents: folderMeta.parents }
      : null,
  };
}

export async function getStartPageToken(token: string): Promise<string> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw classifyGoogleHttpError(response.status, 'startPageToken');
  }
  const payload = await response.json() as { startPageToken?: string };
  if (!payload.startPageToken) {
    throw new GoogleApiError('Google Drive no devolvió startPageToken.', 500, 'error_api');
  }
  return payload.startPageToken;
}

export async function listDriveChanges(
  pageToken: string,
  token: string,
): Promise<{ changes: DriveChangeItem[]; newStartPageToken: string }> {
  const allChanges: DriveChangeItem[] = [];
  let currentToken = pageToken;
  let newStartPageToken = pageToken;
  const fields = 'nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,headRevisionId,trashed,parents))';

  while (currentToken) {
    const params = new URLSearchParams({
      pageToken: currentToken,
      fields,
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/changes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw classifyGoogleHttpError(response.status, 'changes');
    }
    const payload = await response.json() as {
      changes?: DriveChangeItem[];
      nextPageToken?: string;
      newStartPageToken?: string;
    };
    allChanges.push(...(payload.changes ?? []));
    if (payload.newStartPageToken) {
      newStartPageToken = payload.newStartPageToken;
    }
    currentToken = payload.nextPageToken ?? '';
  }

  return { changes: allChanges, newStartPageToken };
}

export async function createDriveItem(params: {
  name: string;
  mimeType: string;
  parentId: string;
  token: string;
}): Promise<DriveFileMeta> {
  const fields = 'id,name,mimeType,webViewLink,modifiedTime,headRevisionId,parents';
  const url = `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name,
      mimeType: params.mimeType,
      parents: [params.parentId],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403 && bodyText.includes('storageQuotaExceeded')) {
      throw new GoogleApiError(
        'La Service Account no puede crear archivos en una cuenta @gmail.com personal ("Mi unidad"). Conecta tu cuenta Google Drive (OAuth) o configura GOOGLE_DRIVE_WEBHOOK_URL.',
        403,
        'configuracion',
      );
    }
    throw classifyGoogleHttpError(response.status, `${params.parentId} (${bodyText.slice(0, 120)})`);
  }

  return await response.json() as DriveFileMeta;
}
