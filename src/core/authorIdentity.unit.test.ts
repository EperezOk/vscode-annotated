import { describe, it, expect, vi } from 'vitest';
import { resolveAuthor, resolveAuthorEmail, type AuthorNameSources } from './authorIdentity';

function sources(overrides: Partial<AuthorNameSources>): AuthorNameSources {
  return {
    gitUserName: async () => undefined,
    settingAuthorName: () => undefined,
    githubAccountLabel: async () => undefined,
    promptForName: async () => undefined,
    persistName: async () => {},
    ...overrides,
  };
}

describe('resolveAuthor', () => {
  it('prefers git user.name when present', async () => {
    expect(await resolveAuthor(sources({ gitUserName: async () => 'Git Name' }))).toBe('Git Name');
  });

  it('falls back to the configured setting', async () => {
    expect(await resolveAuthor(sources({ settingAuthorName: () => 'Setting Name' }))).toBe('Setting Name');
  });

  it('falls back to the GitHub account label', async () => {
    expect(await resolveAuthor(sources({ githubAccountLabel: async () => 'octocat' }))).toBe('octocat');
  });

  it('prompts and persists when nothing else is available', async () => {
    const persistName = vi.fn(async () => {});
    const result = await resolveAuthor(sources({ promptForName: async () => 'Typed Name', persistName }));
    expect(result).toBe('Typed Name');
    expect(persistName).toHaveBeenCalledWith('Typed Name');
  });

  it('returns "Unknown" when every source is empty', async () => {
    expect(await resolveAuthor(sources({}))).toBe('Unknown');
  });

  it('ignores whitespace-only values', async () => {
    expect(await resolveAuthor(sources({ gitUserName: async () => '   ', settingAuthorName: () => 'Real' }))).toBe('Real');
  });
});

describe('resolveAuthorEmail', () => {
  const sources = (over: Partial<Record<'git' | 'setting' | 'github', string | undefined>>) => ({
    gitUserEmail: async () => over.git,
    settingAuthorEmail: () => over.setting,
    githubAccountEmail: async () => over.github,
  });
  it('prefers git, then setting, then github', async () => {
    expect(await resolveAuthorEmail(sources({ git: 'g@x', setting: 's@x', github: 'h@x' }))).toBe('g@x');
    expect(await resolveAuthorEmail(sources({ setting: 's@x', github: 'h@x' }))).toBe('s@x');
    expect(await resolveAuthorEmail(sources({ github: 'h@x' }))).toBe('h@x');
  });
  it('returns empty string when no source provides one', async () => {
    expect(await resolveAuthorEmail(sources({}))).toBe('');
  });
});
