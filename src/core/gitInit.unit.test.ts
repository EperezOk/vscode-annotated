import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForGitInit, type GitInitApi } from './gitInit';

type Listener = (state: 'uninitialized' | 'initialized') => void;

function fakeApi(initial: 'uninitialized' | 'initialized'): GitInitApi & {
  fire(state: 'uninitialized' | 'initialized'): void;
  listenerCount(): number;
} {
  const listeners = new Set<Listener>();
  return {
    state: initial,
    onDidChangeState(listener: Listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire(state) {
      for (const l of [...listeners]) l(state);
    },
    listenerCount: () => listeners.size,
  };
}

describe('waitForGitInit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves immediately when the API is already initialized', async () => {
    const api = fakeApi('initialized');
    await expect(waitForGitInit(api)).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0); // never subscribed
  });

  it('resolves when the state changes to initialized, and disposes the listener', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api);
    api.fire('initialized');
    await expect(promise).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0);
  });

  it('ignores non-initialized state changes', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api, 1000);
    api.fire('uninitialized');
    expect(api.listenerCount()).toBe(1); // still waiting
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves after the timeout when initialization never happens, disposing the listener', async () => {
    const api = fakeApi('uninitialized');
    const promise = waitForGitInit(api, 2000);
    vi.advanceTimersByTime(2000);
    await expect(promise).resolves.toBeUndefined();
    expect(api.listenerCount()).toBe(0);
  });
});
