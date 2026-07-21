const SHA_RE = /^[0-9a-f]{40}$/i;
const COMMIT_MSG = /^(commit|merge|rebase|cherry-pick|pull|am|revert)\b/i;

/** Parse `.git/HEAD`: a `ref: refs/heads/<name>` symref, or a detached 40-hex SHA. */
export function parseHead(content: string): { branch?: string; sha?: string } {
  const line = content.trim();
  const m = /^ref:\s+refs\/heads\/(.+)$/.exec(line);
  if (m) {
    return { branch: m[1] };
  }
  if (SHA_RE.test(line)) {
    return { sha: line };
  }
  return {};
}

/** Parse `.git/packed-refs`: `<sha> <fullref>` lines; skip the `#` header and `^peeled` lines. */
export function parsePackedRefs(content: string): { ref: string; sha: string }[] {
  const out: { ref: string; sha: string }[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('^')) {
      continue;
    }
    const sp = line.indexOf(' ');
    if (sp < 0) {
      continue;
    }
    const sha = line.slice(0, sp);
    const ref = line.slice(sp + 1).trim();
    if (SHA_RE.test(sha) && ref.startsWith('refs/')) {
      out.push({ ref, sha });
    }
  }
  return out;
}

/** Classify a full ref name into a kind + display name (prefix stripped). */
export function classifyRef(fullRef: string): { kind: 'branch' | 'remote' | 'tag' | 'other'; name: string } {
  if (fullRef.startsWith('refs/heads/')) {
    return { kind: 'branch', name: fullRef.slice('refs/heads/'.length) };
  }
  if (fullRef.startsWith('refs/remotes/')) {
    return { kind: 'remote', name: fullRef.slice('refs/remotes/'.length) };
  }
  if (fullRef.startsWith('refs/tags/')) {
    return { kind: 'tag', name: fullRef.slice('refs/tags/'.length) };
  }
  return { kind: 'other', name: fullRef };
}

/** Parse `.git/logs/HEAD` (reflog) into recent commit-ish entries, newest first, deduped by short SHA. */
export function parseReflog(content: string, max: number): { sha: string; summary: string }[] {
  const out: { sha: string; summary: string }[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    const tab = lines[i].indexOf('\t');
    if (tab < 0) {
      continue;
    }
    const message = lines[i].slice(tab + 1);
    if (!COMMIT_MSG.test(message)) {
      continue;
    }
    const newSha = lines[i].slice(0, tab).split(' ')[1];
    if (!newSha || !SHA_RE.test(newSha)) {
      continue;
    }
    const sha = newSha.slice(0, 7);
    if (seen.has(sha)) {
      continue;
    }
    seen.add(sha);
    const colon = message.indexOf(': ');
    const summary = (colon >= 0 ? message.slice(colon + 2) : message).trim();
    out.push({ sha, summary });
  }
  out.reverse();
  return out.slice(0, max);
}
