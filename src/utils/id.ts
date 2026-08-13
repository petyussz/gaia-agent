/**
 * Collision-resistant enough id for keying UI rows.
 *
 * `crypto.randomUUID` is only defined in secure contexts. This app is served over plain http on
 * a LAN address, which is *not* a secure context, so calling it directly throws — a failure that
 * only appears once the app is reached by IP rather than localhost.
 */
export function createId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();

  if (cryptoRef?.getRandomValues) {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
