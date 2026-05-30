// Typed message contract between the extension host and webviews.
// Phase 0 is a skeleton; later phases extend these unions.

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'ping'; value: string };

export type HostToWebview =
  | { type: 'init' }
  | { type: 'pong'; value: string };

export type Message = WebviewToHost | HostToWebview;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Validates an untrusted value as a known Message; returns it narrowed, or null. */
export function parseMessage(raw: unknown): Message | null {
  if (!isObject(raw) || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'init':
      return { type: 'init' };
    case 'ping':
      return typeof raw.value === 'string' ? { type: 'ping', value: raw.value } : null;
    case 'pong':
      return typeof raw.value === 'string' ? { type: 'pong', value: raw.value } : null;
    default:
      return null;
  }
}
