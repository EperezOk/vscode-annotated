import * as vscode from 'vscode';
import { type AuthorNameSources, type AuthorEmailSources } from '../core/authorIdentity';
import { waitForGitInit, type GitInitApi } from '../core/gitInit';

/** Minimal shape of the built-in git extension API we use. */
interface GitApiRepository {
  getConfig(key: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;
}
interface GitApi extends GitInitApi {
  repositories: GitApiRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** AuthorNameSources backed by VSCode APIs. git is desktop-only; the rest work on web. */
export class VscodeAuthorNameSources implements AuthorNameSources, AuthorEmailSources {
  /**
   * The first git repository, awaiting the git API's async repo discovery first
   * (right after activation `repositories` is empty until state is 'initialized').
   */
  private async gitRepo(): Promise<GitApiRepository | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return undefined; // git extension is unavailable in the web host
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      const api = ext.exports.getAPI(1);
      await waitForGitInit(api);
      return api.repositories[0];
    } catch {
      return undefined;
    }
  }

  /** Local-then-global `git config` lookup; undefined when unset/unavailable. */
  private async gitConfig(key: string): Promise<string | undefined> {
    const repo = await this.gitRepo();
    if (!repo) {
      return undefined;
    }
    const local = await repo.getConfig(key).catch(() => undefined);
    if (local) {
      return local;
    }
    return repo.getGlobalConfig(key).catch(() => undefined);
  }

  async gitUserName(): Promise<string | undefined> {
    return this.gitConfig('user.name');
  }

  async gitUserEmail(): Promise<string | undefined> {
    return this.gitConfig('user.email');
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
