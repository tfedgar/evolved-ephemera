export const DOWNLOAD_TOKEN_LIFETIME_SECONDS = 3600;

export interface DownloadTokenPayload {
  sessionId: string;
  customerEmail: string;
  issuedAt: number;
  expiresAt: number;
  productType: string;
  nonce: string;
}

export function readDownloadTokenSecret(
  runtimeEnvironment?: Record<string, unknown>,
  buildEnvironment: Record<string, unknown> = {},
): string | undefined {
  const secret = runtimeEnvironment?.DOWNLOAD_TOKEN_SECRET ?? buildEnvironment.DOWNLOAD_TOKEN_SECRET;
  if (typeof secret !== 'string' || !secret.trim()
    || secret.trim() === 'fallback-secret-key-change-in-production') return undefined;
  return secret;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function createSignedToken(payload: DownloadTokenPayload, secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(data));
  const signatureHex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${data}.${signatureHex}`;
}

export async function verifySignedToken(token: string, secret: string): Promise<DownloadTokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || token.length > 8192) return null;
    const [data, signatureHex] = parts;
    if (!data || !/^[a-f0-9]{64}$/.test(signatureHex)) return null;
    const signature = Uint8Array.from(signatureHex.match(/../g)!, byte => parseInt(byte, 16));
    // Web Crypto verifies the MAC without an application-level string comparison.
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), signature, new TextEncoder().encode(data))) return null;
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const payload: DownloadTokenPayload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.sessionId !== 'string' || !payload.sessionId.trim()
      || typeof payload.customerEmail !== 'string' || !payload.customerEmail.trim()
      || typeof payload.productType !== 'string' || !payload.productType.trim()
      || typeof payload.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(payload.nonce)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
      || payload.issuedAt < 0 || payload.issuedAt > now || payload.expiresAt <= now
      || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt > DOWNLOAD_TOKEN_LIFETIME_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}
