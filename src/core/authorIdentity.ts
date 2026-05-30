/**
 * Sources of an author display name, in priority order. Any source may return
 * undefined when unavailable. On the web host `gitUserName` is typically
 * undefined (the built-in git extension is desktop-only), so resolution falls
 * through to the configured setting, the GitHub session, then a prompt.
 */
export interface AuthorNameSources {
  /** git config user.name (desktop only; undefined on web). */
  gitUserName(): Promise<string | undefined>;
  /** The `annotated.authorName` setting. */
  settingAuthorName(): string | undefined;
  /** A signed-in GitHub session's account label (works on web). */
  githubAccountLabel(): Promise<string | undefined>;
  /** Prompt the user to type a name. */
  promptForName(): Promise<string | undefined>;
  /** Persist a chosen name to the `annotated.authorName` setting. */
  persistName(name: string): Promise<void>;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Resolve the author display name by trying each source in priority order. */
export async function resolveAuthor(sources: AuthorNameSources): Promise<string> {
  const git = clean(await sources.gitUserName());
  if (git) {
    return git;
  }
  const setting = clean(sources.settingAuthorName());
  if (setting) {
    return setting;
  }
  const github = clean(await sources.githubAccountLabel());
  if (github) {
    return github;
  }
  const prompted = clean(await sources.promptForName());
  if (prompted) {
    await sources.persistName(prompted);
    return prompted;
  }
  return 'Unknown';
}
