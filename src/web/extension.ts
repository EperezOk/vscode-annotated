import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';
import { registerCreateAnnotationCommand } from './createAnnotationCommand';
import { DetailPanelProvider } from './detailPanelProvider';
import { GroupStore } from '../core/groupStore';
import { VscodeFileSystem } from './vscodeFileSystem';
import { readTagPalette, promptNewTag } from './tagPalette';
import { NEW_TAG_LABEL, splitPickedTags } from '../core/tags';
import { revealAnnotation } from './navigateToCode';
import { readGitRefInfo } from './gitRefsSource';
import { gitRefSuggestions } from '../core/gitRefs';
import { computeStaleIds } from './staleness';
import { sha256Hex, anchorText } from '../shared/hash';
import { type AnnotationGroup, type GroupStatus } from '../shared/model';
import { bulkStatusToggle } from '../core/sidebarState';
import { CommentStore } from '../core/commentStore';
import { flattenComments, slugifyAuthor } from '../core/comments';
import { resolveAuthor, resolveAuthorEmail } from '../core/authorIdentity';
import { VscodeAuthorNameSources } from './authorSources';
import { newId } from '../shared/ids';

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

  let cachedAuthor: string | undefined;
  let cachedEmail: string | undefined;
  const currentIdentity = async (): Promise<{ author: string; email: string }> => {
    if (cachedAuthor === undefined) {
      const sources = new VscodeAuthorNameSources();
      cachedAuthor = await resolveAuthor(sources);
      cachedEmail = await resolveAuthorEmail(sources);
    }
    return { author: cachedAuthor, email: cachedEmail ?? '' };
  };

  const showGroupWithStale = async (groupId: string): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const fs = new VscodeFileSystem(folder.uri);
    const group = await new GroupStore(fs).getGroup(groupId);
    const staleIds = group ? await computeStaleIds(fs, group) : [];
    const ids = new Set(group?.annotations.map((a) => a.id) ?? []);
    const comments = flattenComments(await new CommentStore(fs).listCommentFiles()).filter((c) => ids.has(c.annotationId));
    const { author } = await currentIdentity();
    detailProvider.showGroup(group, readTagPalette(), staleIds, comments, author);
  };

  provider.onSelectGroup = async (groupId: string): Promise<void> => {
    await showGroupWithStale(groupId);
    await vscode.commands.executeCommand('annotated.detail.focus');
  };

  provider.onBulkResolveRestore = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const groups = (await Promise.all(groupIds.map((id) => store.getGroup(id)))).filter((g): g is AnnotationGroup => g !== null);
    const status = bulkStatusToggle(groups);
    for (const id of groupIds) {
      await store.updateGroup(id, { status }, now());
    }
    await provider.refresh();
  };

  provider.onBulkDelete = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete ${groupIds.length} group${groupIds.length === 1 ? '' : 's'}? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') {
      return;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.deleteGroup(id);
    }
    await provider.refresh();
  };

  provider.onBulkEditTags = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const palette = readTagPalette();
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name })),
      { label: NEW_TAG_LABEL, alwaysShow: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Set tags on ${groupIds.length} group(s)`,
    });
    if (picked === undefined) {
      return;
    }
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    if (addNew) {
      const tag = await promptNewTag();
      if (tag) {
        names.push(tag.name);
      }
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.updateGroup(id, { tags: names }, now());
    }
    await provider.refresh();
  };

  provider.onBulkEditGitRef = async (groupIds): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || groupIds.length === 0) {
      return;
    }
    const info = await readGitRefInfo();
    const suggestions = gitRefSuggestions(info);
    const CLEAR = '$(close) Clear';
    const CUSTOM = '$(edit) Custom…';
    const picked = await vscode.window.showQuickPick(
      [{ label: CLEAR }, { label: CUSTOM }, ...suggestions.map((s) => ({ label: s.label, description: s.description }))],
      { placeHolder: `Set the Git ref on ${groupIds.length} group(s)` },
    );
    if (!picked) {
      return;
    }
    let gitRef: string | null;
    if (picked.label === CLEAR) {
      gitRef = null;
    } else if (picked.label === CUSTOM) {
      const custom = await vscode.window.showInputBox({ prompt: 'Git ref (branch / tag / SHA)' });
      if (custom === undefined) {
        return;
      }
      gitRef = custom.trim() === '' ? null : custom.trim();
    } else {
      gitRef = picked.label;
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    for (const id of groupIds) {
      await store.updateGroup(id, { gitRef }, now());
    }
    await provider.refresh();
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
    const items: vscode.QuickPickItem[] = [
      ...palette.map((t) => ({ label: t.name, picked: group.tags.includes(t.name) })),
      { label: NEW_TAG_LABEL, alwaysShow: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select tags for this group',
    });
    if (picked === undefined) {
      return;
    }
    const { names, addNew } = splitPickedTags(picked.map((item) => item.label));
    if (addNew) {
      const tag = await promptNewTag();
      if (tag) {
        names.push(tag.name);
      }
    }
    await patchGroup(groupId, { tags: names });
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

  detailProvider.onAddComment = async (groupId, annotationId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const { author, email } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).addComment(slugifyAuthor(author), author, email, {
      id: newId(), annotationId, content, timestamp: now(),
    });
    await showGroupWithStale(groupId);
  };

  detailProvider.onEditComment = async (groupId, commentId, content): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const { author } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).updateComment(slugifyAuthor(author), commentId, content);
    await showGroupWithStale(groupId);
  };

  detailProvider.onDeleteComment = async (groupId, commentId): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const { author } = await currentIdentity();
    const fs = new VscodeFileSystem(folder.uri);
    await new CommentStore(fs).deleteComment(slugifyAuthor(author), commentId);
    await showGroupWithStale(groupId);
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

  const onAnnotationCreated = async (groupId: string, annotationId: string): Promise<void> => {
    await showGroupWithStale(groupId);
    detailProvider.openAnnotation(annotationId);
    await vscode.commands.executeCommand('annotated.detail.focus');
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const group = await new GroupStore(new VscodeFileSystem(folder.uri)).getGroup(groupId);
    const annotation = group?.annotations.find((a) => a.id === annotationId);
    if (annotation) {
      await revealAnnotation(folder.uri, annotation);
    }
  };
  context.subscriptions.push(registerCreateAnnotationCommand(onAnnotationCreated));
}

export function deactivate(): void {
  // No-op.
}
