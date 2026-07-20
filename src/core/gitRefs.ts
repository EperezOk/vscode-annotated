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
