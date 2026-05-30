import { describe, it, expect } from 'vitest';
import { parseMessage } from './protocol';

describe('parseMessage', () => {
  it('accepts a valid webview->host ready message', () => {
    expect(parseMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a valid ping message with a string value', () => {
    expect(parseMessage({ type: 'ping', value: 'hi' })).toEqual({ type: 'ping', value: 'hi' });
  });

  it('rejects an unknown type', () => {
    expect(parseMessage({ type: 'nope' })).toBeNull();
  });

  it('rejects a ping without a string value', () => {
    expect(parseMessage({ type: 'ping', value: 42 })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('ready')).toBeNull();
  });
});
