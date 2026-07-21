import { type FileSystem } from './fileSystem';
import { parseHead, parsePackedRefs, classifyRef, parseReflog } from './gitRefParse';

export interface GitRefInfo {
  /** Full HEAD commit SHA, if a repo/commit is available. */
  headSha?: string;
  /** Current branch name (undefined when detached / unavailable). */
  headBranch?: string;
  branches: string[];
  /** Remote-tracking branch names (e.g. "origin/main"); absent ⇒ none. */
  remoteBranches?: string[];
  tags: string[];
  /** Recent commits, newest first; absent ⇒ none. `sha` is already short. */
  commits?: { sha: string; summary: string }[];
}

export interface RefSuggestion {
  /** The value to store as the group's gitRef. */
  ref: string;
  /** Display label. */
  label: string;
  /** Display description (kind). */
  description: string;
}

/** The ref to auto-capture for a new group: current branch, else short HEAD SHA, else null. */
export function currentRef(info: GitRefInfo): string | null {
  if (info.headBranch) {
    return info.headBranch;
  }
  if (info.headSha) {
    return info.headSha.slice(0, 7);
  }
  return null;
}

/** Build Git-ref picker suggestions: HEAD, local branches, remote branches, tags, recent commits. */
export function gitRefSuggestions(info: GitRefInfo): RefSuggestion[] {
  const suggestions: RefSuggestion[] = [];
  if (info.headSha) {
    const short = info.headSha.slice(0, 7);
    suggestions.push({ ref: short, label: short, description: 'current commit (HEAD)' });
  }
  for (const branch of info.branches) {
    suggestions.push({ ref: branch, label: branch, description: 'branch' });
  }
  for (const branch of info.remoteBranches ?? []) {
    suggestions.push({ ref: branch, label: branch, description: 'remote branch' });
  }
  for (const tag of info.tags) {
    suggestions.push({ ref: tag, label: tag, description: 'tag' });
  }
  for (const c of info.commits ?? []) {
    suggestions.push({ ref: c.sha, label: `${c.sha} — ${c.summary}`, description: 'commit' });
  }
  return suggestions;
}

const dec = new TextDecoder();
const SHA_RE = /^[0-9a-f]{40}$/i;

async function readGitText(fs: FileSystem, path: string): Promise<string | null> {
  try {
    return dec.decode(await fs.readFile(path));
  } catch {
    return null;
  }
}

/** Loose-ref leaves under a `.git/refs/...` base: `{ ref: '<.git-relative path>', content }`. Bounded. */
async function walkLooseRefs(fs: FileSystem, base: string): Promise<{ ref: string; content: string }[]> {
  const out: { ref: string; content: string }[] = [];
  const MAX_ENTRIES = 5000;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || out.length >= MAX_ENTRIES) {
      return;
    }
    let entries: { name: string; isDirectory: boolean }[];
    try {
      entries = await fs.list(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_ENTRIES) {
        return;
      }
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path, depth + 1);
      } else {
        const content = await readGitText(fs, path);
        if (content !== null) {
          out.push({ ref: path, content });
        }
      }
    }
  };
  await walk(base, 0);
  return out;
}

/**
 * Build GitRefInfo by reading `.git` through `fs` (host-agnostic). Returns empty info when there is
 * no readable `.git/HEAD` (missing repo, worktree/submodule `.git` file, or a non-git workspace).
 */
export async function readGitRefInfoFromFs(fs: FileSystem): Promise<GitRefInfo> {
  const empty: GitRefInfo = { branches: [], tags: [] };
  const head = await readGitText(fs, '.git/HEAD');
  if (head === null) {
    return empty;
  }
  const { branch, sha: detachedSha } = parseHead(head);

  const refShas = new Map<string, string>();
  const branches: string[] = [];
  const remoteBranches: string[] = [];
  const tags: string[] = [];

  const addRef = (fullRef: string, sha: string | null): void => {
    if (sha) {
      refShas.set(fullRef, sha);
    }
    const { kind, name } = classifyRef(fullRef);
    if (name === '' || name.endsWith('/HEAD')) {
      return; // skip symbolic remote HEAD pointers
    }
    if (kind === 'branch') {
      branches.push(name);
    } else if (kind === 'remote') {
      remoteBranches.push(name);
    } else if (kind === 'tag') {
      tags.push(name);
    }
  };

  const packed = await readGitText(fs, '.git/packed-refs');
  if (packed !== null) {
    for (const { ref, sha } of parsePackedRefs(packed)) {
      addRef(ref, sha);
    }
  }

  for (const base of ['refs/heads', 'refs/remotes', 'refs/tags']) {
    for (const { ref, content } of await walkLooseRefs(fs, `.git/${base}`)) {
      const line = content.trim();
      if (line.startsWith('ref:')) {
        continue; // symbolic ref (e.g. refs/remotes/*/HEAD)
      }
      addRef(ref.slice('.git/'.length), SHA_RE.test(line) ? line : null);
    }
  }

  let headSha = detachedSha;
  if (!headSha && branch) {
    headSha = refShas.get(`refs/heads/${branch}`);
  }

  const reflog = await readGitText(fs, '.git/logs/HEAD');
  const commits = reflog !== null ? parseReflog(reflog, 20) : [];

  const uniq = (a: string[]): string[] => [...new Set(a)];
  return {
    headSha,
    headBranch: branch,
    branches: uniq(branches),
    remoteBranches: uniq(remoteBranches),
    tags: uniq(tags),
    commits,
  };
}
