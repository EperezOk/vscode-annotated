/**
 * Sources of an author display name, in priority order. Any source may return
 * undefined when unavailable. `gitUserName` reads the repo's LOCAL `.git/config`;
 * a globally-configured identity (`~/.gitconfig`) is not readable web-safely and
 * yields undefined, so resolution then falls through to the configured setting,
 * the GitHub session, then a prompt.
 */
export interface AuthorNameSources {
  /** git config user.name from the repo's local .git/config; undefined when unset there. */
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

export interface AuthorEmailSources {
  gitUserEmail(): Promise<string | undefined>;
  settingAuthorEmail(): string | undefined;
  githubAccountEmail(): Promise<string | undefined>;
}

/** Resolve the author email by trying each source; '' if none. */
export async function resolveAuthorEmail(sources: AuthorEmailSources): Promise<string> {
  const git = clean(await sources.gitUserEmail());
  if (git) return git;
  const setting = clean(sources.settingAuthorEmail());
  if (setting) return setting;
  const github = clean(await sources.githubAccountEmail());
  if (github) return github;
  return '';
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
