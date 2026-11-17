import { safeEqual } from '../lib/crypto';
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [, , salt, expected] = hash.split(':');
  if (!salt || !expected) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bytes = Uint8Array.from(salt.match(/../g)!, (v) => parseInt(v, 16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return safeEqual(
    Array.from(new Uint8Array(bits), (v) => v.toString(16).padStart(2, '0')).join(''),
    expected,
  );
}
