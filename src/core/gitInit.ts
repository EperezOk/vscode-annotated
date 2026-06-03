// Waiting for the built-in git extension's API to finish repository discovery.
// Pure logic against a minimal structural interface; no vscode import.

/** The slice of the git extension API (v1) needed to await initialization. */
export interface GitInitApi {
  readonly state: 'uninitialized' | 'initialized';
  onDidChangeState(listener: (state: 'uninitialized' | 'initialized') => void): { dispose(): void };
}

/**
 * Resolve once `api.state` is 'initialized' (repositories discovered), or after
 * `timeoutMs` — whichever comes first. Right after activation the git API reports
 * 'uninitialized' with an empty `repositories` array, so reading it immediately
 * loses the race (the round-3 #1 bug: git config user.name never loaded).
 */
export function waitForGitInit(api: GitInitApi, timeoutMs = 2000): Promise<void> {
  if (api.state === 'initialized') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let listener: { dispose(): void } | undefined;
    const timer = setTimeout(() => {
      listener?.dispose();
      resolve();
    }, timeoutMs);
    listener = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timer);
        listener?.dispose();
        resolve();
      }
    });
  });
}
