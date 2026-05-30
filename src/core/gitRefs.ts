export interface GitRefInfo {
  /** Full HEAD commit SHA, if a repo/commit is available. */
  headSha?: string;
  branches: string[];
  tags: string[];
}

export interface RefSuggestion {
  /** The value to store as the group's gitRef. */
  ref: string;
  /** Display label. */
  label: string;
  /** Display description (kind). */
  description: string;
}

/** Build Git-ref picker suggestions: HEAD short SHA first, then branches, then tags. */
export function gitRefSuggestions(info: GitRefInfo): RefSuggestion[] {
  const suggestions: RefSuggestion[] = [];
  if (info.headSha) {
    const short = info.headSha.slice(0, 7);
    suggestions.push({ ref: short, label: short, description: 'current commit (HEAD)' });
  }
  for (const branch of info.branches) {
    suggestions.push({ ref: branch, label: branch, description: 'branch' });
  }
  for (const tag of info.tags) {
    suggestions.push({ ref: tag, label: tag, description: 'tag' });
  }
  return suggestions;
}
