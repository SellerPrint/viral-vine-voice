/**
 * Conversions base64 <-> binaire portables.
 *
 * Volontairement sans `Buffer` : ce code tourne aussi bien dans le navigateur
 * que sur Cloudflare Workers, où l'API Node `Buffer` n'existe pas sans le flag
 * `nodejs_compat`.
 */

/** Taille de tranche évitant le dépassement de pile de `String.fromCharCode(...)`. */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Copie les octets dans un `ArrayBuffer` exactement dimensionné.
 *
 * `Uint8Array#buffer` peut être plus grand que la vue (offset + longueur), ce
 * qui casse `decodeAudioData` et `new Blob([...])`.
 */
export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
