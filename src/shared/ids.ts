/** Generate a unique id (RFC 4122 v4 UUID). Web Crypto is available in the web host and Node ≥20.19. */
export function newId(): string {
  return crypto.randomUUID();
}
