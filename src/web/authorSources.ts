import * as vscode from 'vscode';
import { type AuthorNameSources, type AuthorEmailSources } from '../core/authorIdentity';
import { readGitIdentityFromFs } from '../core/gitConfig';
import { VscodeFileSystem } from './vscodeFileSystem';

/**
 * AuthorNameSources backed by VS Code APIs. The git identity is read from the
 * repository's LOCAL `.git/config` via `vscode.workspace.fs` (host-agnostic —
 * the built-in `vscode.git` extension's API is unreachable from this web-only
 * extension across the extension-host boundary). The user's global
 * `~/.gitconfig` is not reachable web-safely, so a globally-configured identity
 * yields nothing here and resolution falls through to the `annotated.authorName`
 * setting, the GitHub session label, then a prompt.
 */
export class VscodeAuthorNameSources implements AuthorNameSources, AuthorEmailSources {
  private async gitIdentity(): Promise<{ name?: string; email?: string }> {
    try {
      return await readGitIdentityFromFs(VscodeFileSystem.forWorkspace());
    } catch {
      return {}; // no workspace / unreadable .git/config
    }
  }

  async gitUserName(): Promise<string | undefined> {
    return (await this.gitIdentity()).name;
  }

  async gitUserEmail(): Promise<string | undefined> {
    return (await this.gitIdentity()).email;
  }

  settingAuthorName(): string | undefined {
    return vscode.workspace.getConfiguration('annotated').get<string>('authorName');
  }

  settingAuthorEmail(): string | undefined {
    return vscode.workspace.getConfiguration('annotated').get<string>('authorEmail');
  }

  async githubAccountEmail(): Promise<string | undefined> {
    return undefined; // VS Code's GitHub session doesn't reliably expose email; best-effort.
  }

  async githubAccountLabel(): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession('github', ['read:user'], { silent: true });
      return session?.account.label;
    } catch {
      return undefined;
    }
  }

  async promptForName(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'User name for annotations',
      ignoreFocusOut: true,
    });
  }

  async persistName(name: string): Promise<void> {
    await vscode.workspace
      .getConfiguration('annotated')
      .update('authorName', name, vscode.ConfigurationTarget.Global);
  }
}
