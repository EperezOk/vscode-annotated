import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { readGitRefInfo } from '../../gitRefsSource';

/**
 * Exercises the production git-ref path — `readGitRefInfo()` → `VscodeFileSystem.forWorkspace()`
 * → `vscode.workspace.fs` — against a `.git` planted through the same real filesystem API, inside
 * a real (browser) VS Code extension host. This is the same web-extension-host + `workspace.fs`
 * combination the desktop app uses; only the FS provider backing the workspace differs.
 */
suite('readGitRefInfo over vscode.workspace.fs (real .git)', () => {
  const enc = new TextEncoder();
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);
  const SHA_C = 'c'.repeat(40);
  const SHA_D = 'd'.repeat(40);

  function fail(msg: string): never {
    throw new Error(msg);
  }

  test('reads HEAD branch, loose + packed refs, and reflog commits from a planted .git', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      fail('No workspace folder — @vscode/test-web must be passed the test-workspace folder');
    }
    const fs = new VscodeFileSystem(folder.uri);

    // Plant a minimal but realistic .git through the real workspace filesystem.
    await fs.writeFile('.git/HEAD', enc.encode('ref: refs/heads/feature-x\n'));
    await fs.writeFile('.git/refs/heads/feature-x', enc.encode(`${SHA_A}\n`));
    await fs.writeFile('.git/refs/remotes/origin/main', enc.encode(`${SHA_B}\n`));
    await fs.writeFile('.git/refs/remotes/origin/HEAD', enc.encode('ref: refs/remotes/origin/main\n'));
    await fs.writeFile('.git/refs/tags/v9.9.9', enc.encode(`${SHA_C}\n`));
    await fs.writeFile(
      '.git/packed-refs',
      enc.encode(`# pack-refs with: peeled fully-peeled sorted \n${SHA_D} refs/tags/v9.9.8\n`),
    );
    await fs.writeFile(
      '.git/logs/HEAD',
      enc.encode(`${'0'.repeat(40)} ${SHA_A} Tester <t@e.f> 1700000000 -0300\tcommit: seed commit\n`),
    );

    try {
      const info = await readGitRefInfo();

      if (info.headBranch !== 'feature-x') {
        fail(`headBranch expected feature-x, got ${String(info.headBranch)}`);
      }
      if (info.headSha !== SHA_A) {
        fail(`headSha expected ${SHA_A}, got ${String(info.headSha)}`);
      }
      if (!info.branches.includes('feature-x')) {
        fail(`branches missing feature-x: ${JSON.stringify(info.branches)}`);
      }
      if (!(info.remoteBranches ?? []).includes('origin/main')) {
        fail(`remoteBranches missing origin/main: ${JSON.stringify(info.remoteBranches)}`);
      }
      if ((info.remoteBranches ?? []).some((b) => b.endsWith('/HEAD'))) {
        fail(`remote HEAD symref should be excluded: ${JSON.stringify(info.remoteBranches)}`);
      }
      const tags = info.tags ?? [];
      if (!tags.includes('v9.9.9') || !tags.includes('v9.9.8')) {
        fail(`tags should include both loose and packed: ${JSON.stringify(tags)}`);
      }
      const commit = (info.commits ?? []).find((c) => c.sha === SHA_A.slice(0, 7));
      if (!commit || commit.summary !== 'seed commit') {
        fail(`commits should include the seed commit: ${JSON.stringify(info.commits)}`);
      }
    } finally {
      // Recursively remove the planted .git (in-memory mount, but keep the test hermetic).
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder.uri, '.git'), {
        recursive: true,
        useTrash: false,
      });
    }
  });

  test('returns empty info (never throws) when there is no .git', async () => {
    const info = await readGitRefInfo();
    if (info.headBranch !== undefined || info.branches.length !== 0) {
      fail(`expected empty git info without a .git, got ${JSON.stringify(info)}`);
    }
  });
});
