/**
 * Cifrado AES-256-GCM y firma HMAC-SHA256 usando Web Crypto API nativa de Deno.
 * Protege los tokens OAuth de Google en reposo (private.google_oauth_tokens)
 * y firma el parámetro `state` del flujo OAuth contra ataques CSRF.
 */

const TOKEN_PREFIX = 'v1.';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function getRawEncryptionSecret(): string {
  const secret = (Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY') || '').trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      'Falta configurar GOOGLE_TOKEN_ENCRYPTION_KEY (mínimo 16 caracteres) en Supabase Secrets para cifrar los tokens OAuth de Google.',
    );
  }
  return secret;
}

async function deriveAesKey(): Promise<CryptoKey> {
  const secret = getRawEncryptionSecret();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function deriveHmacKey(): Promise<CryptoKey> {
  const secret = getRawEncryptionSecret();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`oauth-state:${secret}`));
  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function encryptSecret(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const key = await deriveAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${TOKEN_PREFIX}${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(encoded: string): Promise<string> {
  if (!encoded) return '';
  if (!encoded.startsWith(TOKEN_PREFIX)) {
    throw new Error('Formato de token cifrado no reconocido.');
  }
  const rest = encoded.slice(TOKEN_PREFIX.length);
  const parts = rest.split('.');
  if (parts.length !== 2) {
    throw new Error('Token cifrado corrupto.');
  }
  const iv = base64UrlToBytes(parts[0]);
  const ciphertext = base64UrlToBytes(parts[1]);
  const key = await deriveAesKey();
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuf);
}

export async function signOAuthState(payload: Record<string, unknown>, ttlMs = 10 * 60_000): Promise<string> {
  const fullPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
    nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const key = await deriveHmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export async function verifyOAuthState<T extends Record<string, unknown>>(state: string): Promise<T> {
  const parts = (state || '').trim().split('.');
  if (parts.length !== 2) {
    throw new Error('Estado OAuth inválido.');
  }
  const [body, sig] = parts;
  const key = await deriveHmacKey();
  const expectedSigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expectedSig = bytesToBase64Url(new Uint8Array(expectedSigBuf));
  if (!timingSafeEqual(sig, expectedSig)) {
    throw new Error('Firma de estado OAuth inválida.');
  }

  let parsed: T & { exp?: number };
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    parsed = JSON.parse(json) as T & { exp?: number };
  } catch {
    throw new Error('Payload de estado OAuth ilegible.');
  }

  if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
    throw new Error('La solicitud de conexión con Google expiró. Inténtalo nuevamente.');
  }
  return parsed;
}
