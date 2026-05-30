import * as vscode from 'vscode';
import { type GitRefInfo } from '../core/gitRefs';

interface GitRef {
  readonly type: number; // 0 Head, 1 RemoteHead, 2 Tag
  readonly name?: string;
  readonly commit?: string;
}
interface GitRepository {
  readonly state: { readonly HEAD?: { readonly commit?: string }; readonly refs: readonly GitRef[] };
}
interface GitApi {
  readonly repositories: readonly GitRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** Read HEAD/branches/tags from the built-in git extension. Returns empty info on the web host (no git extension). */
export async function readGitRefInfo(): Promise<GitRefInfo> {
  const empty: GitRefInfo = { branches: [], tags: [] };
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) {
    return empty;
  }
  try {
    if (!ext.isActive) {
      await ext.activate();
    }
    const repo = ext.exports.getAPI(1).repositories[0];
    if (!repo) {
      return empty;
    }
    const branches: string[] = [];
    const tags: string[] = [];
    for (const ref of repo.state.refs) {
      if (ref.type === 0 && ref.name) {
        branches.push(ref.name);
      } else if (ref.type === 2 && ref.name) {
        tags.push(ref.name);
      }
    }
    return { headSha: repo.state.HEAD?.commit, branches, tags };
  } catch {
    return empty;
  }
}
