import { type FileSystem } from './fileSystem';

/** The author identity recorded in a git config file. */
export interface GitIdentity {
  name?: string;
  email?: string;
}

/**
 * Parse the `[user]` name/email out of git-config (INI) text. Section names are
 * case-insensitive; surrounding double-quotes on values are stripped; the first
 * value of a repeated key wins. Only recovers what is present in the given config —
 * a repository's local `.git/config`, NOT the user's global `~/.gitconfig`.
 */
export function parseGitConfigIdentity(content: string): GitIdentity {
  const out: GitIdentity = {};
  let inUser = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      const section = (end >= 0 ? line.slice(1, end) : line.slice(1)).trim();
      inUser = section.split(/\s+/)[0].toLowerCase() === 'user';
      continue;
    }
    if (!inUser) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key === 'name' && out.name === undefined) {
      out.name = value;
    } else if (key === 'email' && out.email === undefined) {
      out.email = value;
    }
  }
  return out;
}

/**
 * Read the repository's local `.git/config` through `fs` and parse the author identity.
 * Returns `{}` when there is no readable `.git/config` (web host, no repo, or a
 * worktree/submodule `.git` file). Host-agnostic — mirrors the git-ref `.git` reader.
 */
export async function readGitIdentityFromFs(fs: FileSystem): Promise<GitIdentity> {
  try {
    const content = new TextDecoder().decode(await fs.readFile('.git/config'));
    return parseGitConfigIdentity(content);
  } catch {
    return {};
  }
}
