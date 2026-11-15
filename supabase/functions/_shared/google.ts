/**
 * Conector compartido para Google Drive y Google Docs usando Service Account en Deno.
 * Firma JWT RS256 con Web Crypto API nativa (sin dependencias externas pesadas).
 */

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export type DriveErrorCode = 'sin_permiso' | 'no_encontrada' | 'configuracion' | 'error_api';

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

let cachedToken: { token: string; expiresAt: number } | null = null;

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

async function createSignedJwt(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = creds.token_uri || DEFAULT_TOKEN_URI;

  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    iss: creds.client_email,
    scope: GOOGLE_SCOPES,
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

export async function getGoogleAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }

  const creds = loadServiceAccountCredentials();
  const assertion = await createSignedJwt(creds);
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
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

function classifyGoogleHttpError(status: number, context: string): GoogleApiError {
  if (status === 401 || status === 403) {
    return new GoogleApiError(
      `Sin permiso de lectura en Google (${context}). Comparte el archivo o carpeta como Lector con la Service Account.`,
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

export async function getFileMetadata(fileId: string, token: string): Promise<DriveFileMeta> {
  const fields = 'id,name,mimeType,modifiedTime,headRevisionId,webViewLink,trashed,parents,shortcutDetails';
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const response = await fetch(url, {
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
    // Puede requerir Docs API directa o descarga media si no es formato exportable estándar
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

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
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
