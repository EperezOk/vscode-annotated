import { type GitRefInfo, readGitRefInfoFromFs } from '../core/gitRefs';
import { VscodeFileSystem } from './vscodeFileSystem';

/**
 * Read HEAD/branches/tags/commits by parsing `.git` through `vscode.workspace.fs`.
 * Host-agnostic: works on desktop and remote where a real `.git` exists; returns empty info
 * on the web host or any workspace without a readable `.git` (⇒ free-text ref entry).
 */
export async function readGitRefInfo(): Promise<GitRefInfo> {
  try {
    return await readGitRefInfoFromFs(VscodeFileSystem.forWorkspace());
  } catch {
    return { branches: [], tags: [] };
  }
}
