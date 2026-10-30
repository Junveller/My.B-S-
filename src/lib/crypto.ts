const enc = new TextEncoder();

export const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PBKDF2-SHA256 */
export async function kdf(secret: string, salt: string, iterations = 150_000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  return toHex(bits);
}

/** 헷갈리는 글자(0/O, 1/I/L) 없는 복구 코드: XXXX-XXXX-XXXX */
export function makeRecoveryCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

export const isPin = (s: string) => /^\d{4}$/.test(s);
