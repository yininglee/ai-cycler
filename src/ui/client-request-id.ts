/** Request identifiers also need to work on the HTTP LAN demo. */
export function createClientRequestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
