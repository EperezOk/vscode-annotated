/** Generate a unique id (RFC 4122 v4 UUID). Web Crypto is available in the web host and Node ≥20.19. */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The first `len` characters of an id with hyphens removed — the human handle
 * embedded in a group's filename (`<title-slug>-<idSegment>.json`). The full id
 * stays the canonical identifier inside the file.
 */
export function idSegment(id: string, len = 8): string {
  return id.replace(/-/g, '').slice(0, len);
}
