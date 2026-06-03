import * as vscode from 'vscode';
import { type AuthorNameSources, type AuthorEmailSources } from '../core/authorIdentity';

/** Minimal shape of the built-in git extension API we use. */
interface GitApiRepository {
  getConfig(key: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;
}
interface GitApi {
  repositories: GitApiRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/** AuthorNameSources backed by VSCode APIs. git is desktop-only; the rest work on web. */
export class VscodeAuthorNameSources implements AuthorNameSources, AuthorEmailSources {
  async gitUserName(): Promise<string | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return undefined; // git extension is unavailable in the web host
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      const repo = ext.exports.getAPI(1).repositories[0];
      if (!repo) {
        return undefined;
      }
      const local = await repo.getConfig('user.name').catch(() => undefined);
      if (local) {
        return local;
      }
      return await repo.getGlobalConfig('user.name').catch(() => undefined);
    } catch {
      return undefined;
    }
  }

  async gitUserEmail(): Promise<string | undefined> {
    const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!ext) {
      return undefined; // git extension is unavailable in the web host
    }
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
      const repo = ext.exports.getAPI(1).repositories[0];
      if (!repo) {
        return undefined;
      }
      const local = await repo.getConfig('user.email').catch(() => undefined);
      if (local) {
        return local;
      }
      return await repo.getGlobalConfig('user.email').catch(() => undefined);
    } catch {
      return undefined;
    }
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
