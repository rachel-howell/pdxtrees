/** Canonical deployed URL. QR codes always encode this origin, even in dev. */
export const SITE_URL = 'https://rachel-howell.github.io/pdxtrees/';

export function treeUrl(treeId: string): string {
  return `${SITE_URL}#/tree/${treeId}`;
}

/** Extract a tree id from a location hash like "#/tree/<uuid>", else null. */
export function treeIdFromHash(hash: string): string | null {
  const match = hash.match(/^#\/tree\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}
