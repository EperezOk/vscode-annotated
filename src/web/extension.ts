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
import { computeStaleIds } from './staleness';
import { sha256Hex, anchorText } from '../shared/hash';
import { type GroupStatus } from '../shared/model';

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

  const now = (): number => Math.floor(Date.now() / 1000);

  const showGroupWithStale = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const group = await new GroupStore(fs).getGroup(groupId);
    const staleIds = group ? await computeStaleIds(fs, group) : [];
    detailProvider.showGroup(group, readTagPalette(), staleIds);
  };

  provider.onSelectGroup = async (groupId: string): Promise<void> => {
    await showGroupWithStale(groupId);
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
    const ok = await store.updateAnnotation(groupId, annotationId, content, now());
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };

  const patchGroup = async (
    groupId: string,
    patch: { title?: string; tags?: string[]; gitRef?: string | null; status?: GroupStatus },
  ): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const ok = await new GroupStore(new VscodeFileSystem(folder.uri)).updateGroup(groupId, patch, now());
    if (ok) {
      await showGroupWithStale(groupId);
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

  detailProvider.onUpdateGroupStatus = async (groupId, status): Promise<void> => {
    await patchGroup(groupId, { status });
  };

  detailProvider.onReorderAnnotations = async (groupId, annotationIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const ok = await store.reorderAnnotations(groupId, annotationIds, now());
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };

  detailProvider.onUpdateAnnotationRange = async (groupId, annotationId, startLine, endLine): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const store = new GroupStore(fs);
    const group = await store.getGroup(groupId);
    const annotation = group?.annotations.find((a) => a.id === annotationId);
    if (!annotation) {
      return;
    }
    const range = { startLine, endLine };
    let contentHash = annotation.contentHash;
    try {
      const fileText = new TextDecoder().decode(await fs.readFile(annotation.file));
      contentHash = await sha256Hex(anchorText(fileText, range));
    } catch {
      // file unreadable — keep the old hash (the row will show stale)
    }
    const ok = await store.updateAnnotationRange(groupId, annotationId, range, contentHash, now());
    if (ok) {
      await showGroupWithStale(groupId);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );

  context.subscriptions.push(registerCreateAnnotationCommand());
}

export function deactivate(): void {
  // No-op.
}
