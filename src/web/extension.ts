import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';
import { registerCreateAnnotationCommand } from './createAnnotationCommand';
import { DetailPanelProvider } from './detailPanelProvider';
import { GroupStore } from '../core/groupStore';
import { VscodeFileSystem } from './vscodeFileSystem';
import { readTagPalette } from './tagPalette';
import { revealAnnotation } from './navigateToCode';
import { readGitRefInfo } from './gitRefsSource';
import { gitRefSuggestions } from '../core/gitRefs';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, provider),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/.annotations/**/*.json');
  const refreshSidebar = (): void => {
    void provider.refresh();
  };
  watcher.onDidCreate(refreshSidebar);
  watcher.onDidChange(refreshSidebar);
  watcher.onDidDelete(refreshSidebar);
  context.subscriptions.push(watcher);

  const detailProvider = new DetailPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DetailPanelProvider.viewType, detailProvider),
  );

  provider.onSelectGroup = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const group = folder
      ? await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId)
      : null;
    detailProvider.showGroup(group, readTagPalette());
    await vscode.commands.executeCommand('annotated.detail.focus');
  };

  detailProvider.onSelectAnnotation = (annotation): void => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      void revealAnnotation(folder.uri, annotation);
    }
  };

  detailProvider.onUpdateAnnotation = async (groupId, annotationId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const ok = await store.updateAnnotation(groupId, annotationId, content, Math.floor(Date.now() / 1000));
    if (ok) {
      const updated = await store.getGroup(groupId);
      detailProvider.showGroup(updated, readTagPalette());
    }
  };

  const now = (): number => Math.floor(Date.now() / 1000);
  const reloadDetail = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const updated = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    detailProvider.showGroup(updated, readTagPalette());
  };
  const patchGroup = async (
    groupId: string,
    patch: { title?: string; tags?: string[]; gitRef?: string | null },
  ): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const ok = await new GroupStore(new VscodeFileSystem(folder.uri)).updateGroup(groupId, patch, now());
    if (ok) {
      await reloadDetail(groupId);
    }
  };

  detailProvider.onSetGroupTitle = (groupId, title): void => {
    void patchGroup(groupId, { title });
  };

  detailProvider.onEditTags = async (groupId): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    if (!group) {
      return;
    }
    const palette = readTagPalette();
    const picked = await vscode.window.showQuickPick(
      palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) })),
      { canPickMany: true, placeHolder: 'Select tags for this group' },
    );
    if (picked === undefined) {
      return;
    }
    await patchGroup(groupId, { tags: picked.map((p) => p.label) });
  };

  detailProvider.onEditGitRef = async (groupId): Promise<void> => {
    const info = await readGitRefInfo();
    const suggestions = gitRefSuggestions(info);
    let ref: string | undefined;
    if (suggestions.length > 0) {
      const CUSTOM = '$(edit) Custom…';
      const CLEAR = '$(close) Clear';
      const picked = await vscode.window.showQuickPick(
        [{ label: CLEAR }, { label: CUSTOM }, ...suggestions.map((s) => ({ label: s.label, description: s.description }))],
        { placeHolder: 'Set the group’s Git ref' },
      );
      if (!picked) {
        return;
      }
      if (picked.label === CLEAR) {
        await patchGroup(groupId, { gitRef: null });
        return;
      }
      ref = picked.label === CUSTOM ? await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' }) : picked.label;
    } else {
      ref = await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA), or empty to clear' });
    }
    if (ref === undefined) {
      return;
    }
    await patchGroup(groupId, { gitRef: ref.trim() === '' ? null : ref.trim() });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );

  context.subscriptions.push(registerCreateAnnotationCommand());
}

export function deactivate(): void {
  // No-op.
}
